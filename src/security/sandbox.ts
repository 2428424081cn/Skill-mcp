// 隔离执行：inline（node:vm 极简上下文）+ node/shell（子进程 + 临时文件契约），超时预算强制（DESIGN Q6）
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import type { JsonSchemaNode, JsonValue, RunResult, SkillRecord } from "../types.ts";
import { readJson, uid, validateAgainstSchema, writeJson } from "../util.ts";

export interface RunOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  workdir?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// 最小权限子进程环境（DESIGN Q6 / OWASP MCP Top10「excessive agency」）：
// 只透传运行必需的基础变量 + manifest.permissions.env 声明的白名单；声明 "*" 才给完整环境。
function childEnv(declared: string[] | undefined, extra?: Record<string, string>): Record<string, string | undefined> {
  if (declared && declared.includes("*")) return { ...process.env, ...(extra ?? {}) };
  const base = process.platform === "win32"
    ? ["PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "COMSPEC"]
    : ["PATH", "HOME", "TMPDIR", "LANG"];
  const env: Record<string, string | undefined> = {};
  for (const k of base) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  for (const k of declared ?? []) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return { ...env, ...(extra ?? {}) };
}

function isTimeoutError(e: unknown): boolean {
  // vm 超时抛出的 Error 是跨 realm 的（instanceof 不可靠），直接查 code
  if (e !== null && typeof e === "object" && (e as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return true;
  return e !== null && typeof e === "object" && (e as { __skillTimeout?: boolean }).__skillTimeout === true;
}

function isJsonSerializable(v: unknown): boolean {
  const seen = new Set<object>();
  const check = (x: unknown): boolean => {
    if (x === null) return true;
    const t = typeof x;
    if (t === "string" || t === "boolean") return true;
    if (t === "number") return Number.isFinite(x as number);
    if (t !== "object") return false; // undefined / function / symbol / bigint
    const obj = x as object;
    if (seen.has(obj)) return false; // 循环引用
    seen.add(obj);
    const ok = Array.isArray(x) ? x.every(check) : Object.values(x as Record<string, unknown>).every(check);
    seen.delete(obj);
    return ok;
  };
  return check(v);
}

function finalizeOutput(value: unknown, schema: JsonSchemaNode | undefined, t0: number): RunResult {
  const latencyMs = Date.now() - t0;
  if (value === undefined || value === null) {
    return { ok: true, output: null, outcome: "success", latencyMs };
  }
  if (!isJsonSerializable(value)) {
    return { ok: false, output: null, error: "output is not JSON-serializable", outcome: "failure", latencyMs };
  }
  const errors = validateAgainstSchema(value as JsonValue, schema);
  if (errors.length > 0) {
    return { ok: false, output: null, error: "output failed schema validation: " + errors.join("; "), outcome: "failure", latencyMs };
  }
  // JSON 往返：把 vm 跨 realm 的对象规范化为宿主 realm 对象（避免原型不一致）
  return { ok: true, output: JSON.parse(JSON.stringify(value)) as JsonValue, outcome: "success", latencyMs };
}

export async function runInline(record: SkillRecord, input: JsonValue, opts: RunOptions = {}): Promise<RunResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? record.manifest.permissions.maxDurationMs ?? DEFAULT_TIMEOUT_MS;
  const code = record.manifest.entrypoint.code;
  if (!code) {
    return { ok: false, output: null, error: "entrypoint.code is missing", outcome: "failure", latencyMs: Date.now() - t0 };
  }
  const schema = record.manifest.io?.output?.schema;
  try {
    // 极简上下文：只暴露 JSON / Math，无 require / process / fs / 网络
    const ctx: Record<string, unknown> = createContext({ JSON, Math });
    // 编译函数体（vm timeout 覆盖编译期）
    const fn = runInContext("(function(input){" + code + "})", ctx, { timeout: timeoutMs }) as (input: JsonValue) => unknown;
    // 在 vm 内调用，使同步死循环命中 vm timeout
    ctx.fn = fn;
    ctx.input = input;
    const raw: unknown = runInContext("fn(input)", ctx, { timeout: timeoutMs });
    let value: unknown = raw;
    if (raw !== null && typeof raw === "object" && typeof (raw as Promise<unknown>).then === "function") {
      // async 返回：外部 setTimeout 兜底
      value = await Promise.race([
        Promise.resolve(raw as Promise<unknown>),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(Object.assign(new Error("async execution timed out"), { __skillTimeout: true })), timeoutMs);
        }),
      ]);
    }
    return finalizeOutput(value, schema, t0);
  } catch (e) {
    if (isTimeoutError(e)) {
      return { ok: false, output: null, error: "execution timed out", outcome: "timeout", latencyMs: Date.now() - t0 };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: null, error: msg, outcome: "failure", latencyMs: Date.now() - t0 };
  }
}

async function runChild(record: SkillRecord, input: JsonValue, opts: RunOptions, kind: "node" | "shell"): Promise<RunResult> {
  const t0 = Date.now();
  const timeoutMs = opts.timeoutMs ?? record.manifest.permissions.maxDurationMs ?? DEFAULT_TIMEOUT_MS;
  const workdir = opts.workdir ?? tmpdir();
  const entryFile = record.manifest.entrypoint.file;
  if (!entryFile) {
    return { ok: false, output: null, error: "entrypoint.file is missing", outcome: "failure", latencyMs: Date.now() - t0 };
  }
  const file = join(record.dir, entryFile);
  const inPath = join(workdir, `.skill-mcp-tmp-${uid()}.json`);
  const outPath = join(workdir, `.skill-mcp-tmp-${uid()}.json`);
  const schema = record.manifest.io?.output?.schema;
  try {
    writeJson(inPath, input);
    // 注意：沙箱禁止 pipe 捕获子进程 stdio，一律 stdio: "ignore"
    const env = childEnv(record.manifest.permissions?.env, opts.env);
    const child = kind === "node"
      ? spawn(process.execPath, [file, inPath, outPath], { cwd: workdir, stdio: "ignore", env })
      : spawn(file, [inPath, outPath], { cwd: workdir, stdio: "ignore", env });
    const outcome = await new Promise<"success" | "failure" | "timeout">((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
        resolve("timeout");
      }, timeoutMs);
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve("failure");
      });
      child.on("exit", (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(code === 0 ? "success" : "failure");
      });
    });
    if (outcome === "timeout") {
      return { ok: false, output: null, error: "execution timed out", outcome: "timeout", latencyMs: Date.now() - t0 };
    }
    if (outcome === "failure") {
      return { ok: false, output: null, error: "child process exited with non-zero code", outcome: "failure", latencyMs: Date.now() - t0 };
    }
    const value = readJson<JsonValue | null>(outPath, null);
    return finalizeOutput(value, schema, t0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: null, error: msg, outcome: "failure", latencyMs: Date.now() - t0 };
  } finally {
    // 始终清理临时文件
    for (const p of [inPath, outPath]) {
      try { rmSync(p, { force: true }); } catch { /* ignore */ }
    }
  }
}

// 约定：node <entrypoint.file> <inputJsonPath> <outputJsonPath>
export async function runNode(record: SkillRecord, input: JsonValue, opts: RunOptions = {}): Promise<RunResult> {
  return runChild(record, input, opts, "node");
}

// 约定：<entrypoint.file> <inputJsonPath> <outputJsonPath>（sh 脚本）
export async function runShell(record: SkillRecord, input: JsonValue, opts: RunOptions = {}): Promise<RunResult> {
  return runChild(record, input, opts, "shell");
}

// L4 更新门：在沙箱中运行 skill 自带测试（约定 node <entry>，cwd = 包目录，exit 0 = 通过）。
// 测试进程与执行进程同样受最小环境约束（env 白名单 + SKILL_MCP_TEST 标记），超时 kill。
export async function runSkillTests(dir: string, entry: string, timeoutMs = 60_000): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const t0 = Date.now();
  const entryPath = join(dir, entry);
  if (!existsSync(entryPath)) {
    return { ok: false, error: "tests entry not found: " + entry, latencyMs: Date.now() - t0 };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, [entryPath], {
      cwd: dir, stdio: "ignore", env: childEnv([], { SKILL_MCP_TEST: "1" }),
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolve({ ok: false, error: "tests timed out", latencyMs: Date.now() - t0 });
    }, timeoutMs);
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String(e), latencyMs: Date.now() - t0 });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code === 0
        ? { ok: true, latencyMs: Date.now() - t0 }
        : { ok: false, error: "tests exited with code " + code, latencyMs: Date.now() - t0 });
    });
  });
}

// 按 entrypoint.kind 分发，任何异常都折叠为 failure
export async function runSkill(record: SkillRecord, input: JsonValue, opts: RunOptions = {}): Promise<RunResult> {
  const t0 = Date.now();
  try {
    switch (record.manifest.entrypoint.kind) {
      case "inline":
        return await runInline(record, input, opts);
      case "node":
        return await runNode(record, input, opts);
      case "shell":
        return await runShell(record, input, opts);
      default:
        return { ok: false, output: null, error: "unknown entrypoint kind", outcome: "failure", latencyMs: Date.now() - t0 };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, output: null, error: msg, outcome: "failure", latencyMs: Date.now() - t0 };
  }
}
