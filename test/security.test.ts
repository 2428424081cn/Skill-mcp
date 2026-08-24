// 安全子系统测试：三层权限 broker + 沙箱执行（inline / node / shell）
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionBroker } from "../src/security/permissions.ts";
import { runInline, runNode, runShell, runSkill } from "../src/security/sandbox.ts";
import type { PermissionSet, SkillManifest, SkillRecord } from "../src/types.ts";

const EMPTY_PERMS: PermissionSet = {
  fsRead: [], fsWrite: [], network: [], tools: [], env: [],
  maxDurationMs: 5000, maxCostCents: 10, mutating: false,
};

function makeRecord(partial: Partial<SkillManifest> = {}): SkillRecord {
  const manifest: SkillManifest = {
    schemaVersion: 1,
    name: "test",
    namespace: "ns",
    version: "1.0.0",
    description: "test skill",
    category: "test",
    tags: [],
    triggers: [],
    keywords: [],
    whenToUse: "",
    whenNotToUse: "",
    useCases: [],
    preconditions: {},
    io: { input: { semanticType: "json" }, output: { semanticType: "json" } },
    capabilities: [],
    consumes: [],
    dependencies: [],
    permissions: EMPTY_PERMS,
    entrypoint: { kind: "inline", code: "return null;" },
    ...partial,
  };
  return {
    key: "ns:test@1.0.0",
    manifest,
    contentHash: "hash",
    dir: ".",
    installedAt: Date.now(),
    profileText: "",
    files: {},
  };
}

// ---------- 权限 broker ----------

test("broker: policy deny moves network entry to denied", () => {
  const broker = new PermissionBroker({ rules: [{ action: "deny", permission: "network", pattern: "api.example.com" }] });
  const ev = broker.evaluate({ ...EMPTY_PERMS, network: ["api.example.com"] });
  assert.ok(!ev.allowed.network.includes("api.example.com"));
  assert.ok(ev.denied.includes("network: api.example.com"));
  assert.equal(ev.asks.length, 0);
});

test("broker: policy ask moves network entry to asks", () => {
  const broker = new PermissionBroker({ rules: [{ action: "ask", permission: "network", pattern: "api.example.com" }] });
  const ev = broker.evaluate({ ...EMPTY_PERMS, network: ["api.example.com"] });
  assert.equal(ev.asks.length, 1);
  assert.equal(ev.asks[0].permission, "network");
  assert.equal(ev.asks[0].detail, "network: api.example.com");
  assert.ok(!ev.allowed.network.includes("api.example.com"));
});

test("broker: no rule -> network/fsWrite/tools/env default deny, fsRead default allow", () => {
  const broker = new PermissionBroker();
  const ev = broker.evaluate({
    ...EMPTY_PERMS,
    fsRead: ["/tmp/work"],
    fsWrite: ["/tmp/out"],
    network: ["api.example.com"],
    tools: ["srv:tool"],
    env: ["HOME"],
  });
  assert.deepEqual(ev.allowed.fsRead, ["/tmp/work"]);
  assert.ok(ev.denied.includes("network: api.example.com"));
  assert.ok(ev.denied.includes("fsWrite: /tmp/out"));
  assert.ok(ev.denied.includes("tools: srv:tool"));
  assert.ok(ev.denied.includes("env: HOME"));
});

test("broker: defaultNetwork ask config routes to asks", () => {
  const broker = new PermissionBroker({ defaultNetwork: "ask" });
  const ev = broker.evaluate({ ...EMPTY_PERMS, network: ["api.example.com"] });
  assert.equal(ev.asks.length, 1);
  assert.equal(ev.asks[0].detail, "network: api.example.com");
});

test("broker: mutating skill fsWrite follows defaultMutating", () => {
  const broker = new PermissionBroker({ defaultMutating: "ask" });
  const ev = broker.evaluate({ ...EMPTY_PERMS, mutating: true, fsWrite: ["/tmp/out"] });
  assert.equal(ev.asks.length, 1);
  assert.equal(ev.asks[0].detail, "fsWrite: /tmp/out");
});

test("broker: sessionGrants narrows allowed set", () => {
  const broker = new PermissionBroker();
  const ev = broker.evaluate({ ...EMPTY_PERMS, fsRead: ["/a", "/b"] }, { fsRead: ["/a"] });
  assert.deepEqual(ev.allowed.fsRead, ["/a"]);
});

test("broker: session grant satisfies pending ask (HITL second stage)", () => {
  const broker = new PermissionBroker({ defaultMutating: "ask" });
  const declared = { ...EMPTY_PERMS, mutating: true, fsWrite: ["/tmp/out"] };
  const ev = broker.evaluate(declared, { fsWrite: ["/tmp/out"] });
  assert.equal(ev.asks.length, 0);
  assert.deepEqual(ev.allowed.fsWrite, ["/tmp/out"]);
});

test("broker: grant partially covers asks -> only uncovered entries ask", () => {
  const broker = new PermissionBroker({ defaultNetwork: "ask" });
  const declared = { ...EMPTY_PERMS, network: ["a.example.com", "b.example.com"] };
  const ev = broker.evaluate(declared, { network: ["a.example.com"] });
  assert.equal(ev.asks.length, 1);
  assert.equal(ev.asks[0].detail, "network: b.example.com");
  assert.deepEqual(ev.allowed.network, ["a.example.com"]);
});

test("broker: grant token expired -> checkGrant false", async () => {
  const broker = new PermissionBroker();
  const declared = { ...EMPTY_PERMS, network: ["api.example.com"] };
  const token = broker.issueGrant("ns:test@1.0.0", { network: ["api.example.com"] }, 1);
  await new Promise((r) => setTimeout(r, 10));
  const res = broker.checkGrant(token, declared, "ns:test@1.0.0");
  assert.equal(res.allowed, false);
  assert.ok(res.denied.some((d) => d.includes("expired")));
});

test("broker: grant token skillKey mismatch -> false, match -> true, no token -> false", () => {
  const broker = new PermissionBroker();
  const declared = { ...EMPTY_PERMS, network: ["api.example.com"] };
  const token = broker.issueGrant("ns:test@1.0.0", { network: ["api.example.com"] });
  assert.equal(broker.checkGrant(token, declared, "ns:other@2.0.0").allowed, false);
  assert.equal(broker.checkGrant(token, declared, "ns:test@1.0.0").allowed, true);
  assert.equal(broker.checkGrant(undefined, declared).allowed, false);
});

test("broker: grant token missing a declared entry -> denied lists it", () => {
  const broker = new PermissionBroker();
  const declared = { ...EMPTY_PERMS, fsRead: ["/a", "/b"] };
  const token = broker.issueGrant("ns:test@1.0.0", { fsRead: ["/a"] });
  const res = broker.checkGrant(token, declared, "ns:test@1.0.0");
  assert.equal(res.allowed, false);
  assert.ok(res.denied.includes("fsRead: /b"));
});

test("broker: isAllowed supports exact, prefix and wildcard", () => {
  const broker = new PermissionBroker();
  const set: PermissionSet = { ...EMPTY_PERMS, fsRead: ["/tmp/base"], network: ["api.example.com"] };
  assert.ok(broker.isAllowed(set, "network", "api.example.com"));
  assert.ok(broker.isAllowed(set, "network", "api.example.com/v1"));          // 前缀（段边界）
  assert.ok(broker.isAllowed(set, "fsRead", "/tmp/base/docs"));              // 前缀（路径段）
  assert.ok(!broker.isAllowed(set, "network", "api.example.com.evil.com"));  // 非段边界 -> 拒绝
  assert.ok(!broker.isAllowed(set, "network", "example.com"));               // 非前缀
  const wild: PermissionSet = { ...EMPTY_PERMS, network: ["*"] };
  assert.ok(broker.isAllowed(wild, "network", "anywhere.example.org"));
});

// ---------- 沙箱执行 ----------

test("sandbox: inline success with object output", async () => {
  const record = makeRecord({
    io: {
      input: { semanticType: "json" },
      output: { semanticType: "json", schema: { type: "object", properties: { hello: { type: "string" } }, required: ["hello"] } },
    },
    entrypoint: { kind: "inline", code: "return { hello: 'hi ' + input.name };" },
  });
  const r = await runInline(record, { name: "world" });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "success");
  assert.deepEqual(r.output, { hello: "hi world" });
});

test("sandbox: inline output fails schema -> failure with message", async () => {
  const record = makeRecord({
    io: { input: { semanticType: "json" }, output: { semanticType: "json", schema: { type: "object", properties: { hello: { type: "string" } }, required: ["hello"] } } },
    entrypoint: { kind: "inline", code: "return { nope: 1 };" },
  });
  const r = await runInline(record, {});
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "failure");
  assert.ok(r.error && r.error.includes("schema"));
});

test("sandbox: throwing inline code -> failure", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "throw new Error('boom');" } });
  const r = await runInline(record, {});
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "failure");
  assert.ok(r.error && r.error.includes("boom"));
});

test("sandbox: sync infinite loop with timeoutMs -> timeout", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "while (true) {}" } });
  const r = await runInline(record, {}, { timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "timeout");
});

test("sandbox: never-resolving async body -> timeout", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "return new Promise(() => {});" } });
  const r = await runInline(record, {}, { timeoutMs: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, "timeout");
});

test("sandbox: async body awaited", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "return Promise.resolve(42);" } });
  const r = await runInline(record, {});
  assert.equal(r.ok, true);
  assert.equal(r.output, 42);
});

test("sandbox: inline cannot access process/require", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "return typeof process + '|' + typeof require;" } });
  const r = await runInline(record, {});
  assert.equal(r.ok, true);
  assert.equal(r.output, "undefined|undefined");
});

test("sandbox: runNode end-to-end with temp .mjs script", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  try {
    writeFileSync(join(dir, "echo.mjs"), [
      'import { readFileSync, writeFileSync } from "node:fs";',
      'const input = JSON.parse(readFileSync(process.argv[2], "utf8"));',
      'writeFileSync(process.argv[3], JSON.stringify({ got: input.x * 2 }));',
    ].join("\n"));
    const record = {
      ...makeRecord({
        io: {
          input: { semanticType: "json" },
          output: { semanticType: "json", schema: { type: "object", properties: { got: { type: "number" } }, required: ["got"] } },
        },
        entrypoint: { kind: "node", file: "echo.mjs" },
      }),
      dir,
    };
    const r = await runNode(record, { x: 21 }, { workdir: dir, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "success");
    assert.deepEqual(r.output, { got: 42 });
    // 临时文件已清理
    const leftovers = readdirSync(dir).filter((f: string) => f.startsWith(".skill-mcp-tmp-"));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: runNode non-zero exit -> failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  try {
    writeFileSync(join(dir, "fail.mjs"), "process.exit(3);\n");
    const record = { ...makeRecord({ entrypoint: { kind: "node", file: "fail.mjs" } }), dir };
    const r = await runNode(record, {}, { workdir: dir, timeoutMs: 5000 });
    assert.equal(r.ok, false);
    assert.equal(r.outcome, "failure");
    const leftovers = readdirSync(dir).filter((f: string) => f.startsWith(".skill-mcp-tmp-"));
    assert.deepEqual(leftovers, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: runShell with sh script", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  try {
    const script = join(dir, "echo.sh");
    writeFileSync(script, [
      "#!/bin/sh",
      `node -e "const fs=require('fs');const i=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));fs.writeFileSync(process.argv[3],JSON.stringify({sh:true,val:i.v}));" "$1" "$2"`,
      "",
    ].join("\n"));
    chmodSync(script, 0o755);
    const record = { ...makeRecord({ entrypoint: { kind: "shell", file: "echo.sh" } }), dir };
    const r = await runShell(record, { v: 7 }, { workdir: dir, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "success");
    assert.deepEqual(r.output, { sh: true, val: 7 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: child env limited to declared whitelist (least privilege)", async () => {
  process.env.SKILL_MCP_MARKER = "present";
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  try {
    writeFileSync(join(dir, "env.mjs"), [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.argv[3], JSON.stringify({ marker: process.env.SKILL_MCP_MARKER ?? null, hasPath: process.env.PATH !== undefined }));',
    ].join("\n"));
    const record = { ...makeRecord({ entrypoint: { kind: "node", file: "env.mjs" } }), dir }; // permissions.env 默认 []
    const r = await runNode(record, {}, { workdir: dir, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal((r.output as { marker: string | null }).marker, null, "未声明的环境变量不透传给子进程");
    assert.equal((r.output as { hasPath: boolean }).hasPath, true, "基础运行环境保留");
  } finally {
    delete process.env.SKILL_MCP_MARKER;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: declared env whitelist passes through", async () => {
  process.env.SKILL_MCP_MARKER = "present";
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-test-"));
  try {
    writeFileSync(join(dir, "env2.mjs"), [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.argv[3], JSON.stringify({ marker: process.env.SKILL_MCP_MARKER ?? null }));',
    ].join("\n"));
    const record = {
      ...makeRecord({
        permissions: { ...EMPTY_PERMS, env: ["SKILL_MCP_MARKER"] },
        entrypoint: { kind: "node", file: "env2.mjs" },
      }),
      dir,
    };
    const r = await runNode(record, {}, { workdir: dir, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal((r.output as { marker: string | null }).marker, "present", "声明白名单内的变量透传");
  } finally {
    delete process.env.SKILL_MCP_MARKER;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sandbox: runSkill dispatches to inline", async () => {
  const record = makeRecord({ entrypoint: { kind: "inline", code: "return { ok: true };" } });
  const r = await runSkill(record, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.output, { ok: true });
});
