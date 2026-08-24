// Skill-MCP 组合根：Registry + 检索 + 规划 + 执行 + 评价 + 权限 -> 9 个 MCP 工具
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpServer } from "./protocol/mcp.ts";
import type { McpServer, PromptResult, PromptSpec, ResourceContent, ResourceSpec, ToolResult, ToolSpec } from "./protocol/mcp.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { makeEmbedder } from "./retrieval/embeddings.ts";
import type { EmbeddingConfig } from "./retrieval/embeddings.ts";
import { buildIndex } from "./retrieval/indexer.ts";
import type { IndexBundle } from "./retrieval/indexer.ts";
import { searchSkills } from "./retrieval/hybrid.ts";
import { HeuristicReranker, LLMReranker } from "./retrieval/rerank.ts";
import { scoreFits } from "./planning/fit.ts";
import { planWorkflow } from "./planning/plan.ts";
import { executeWorkflow } from "./planning/executor.ts";
import type { ExecEnv } from "./planning/executor.ts";
import { runSkill as sandboxRunSkill, runSkillTests } from "./security/sandbox.ts";
import { canonicalCatalogPayload, verifyHash } from "./security/signing.ts";
import { PermissionBroker } from "./security/permissions.ts";
import type { PermissionEvaluation, PolicyConfig } from "./security/permissions.ts";
import { Ranker, TelemetryStore } from "./eval/telemetry.ts";
import { TaskClusterer } from "./eval/taskcluster.ts";
import { qualityScore, thompsonSample, wilsonQuality } from "./eval/ranking.ts";
import { RecipeStore } from "./eval/recipes.ts";
import { compareSemver, ensureDir, nowMs, parseSemver, uid } from "./util.ts";
import type {
  Embedder, GrantToken, InvocationLog, JsonValue, PermissionSet, Reranker,
  SearchFilters, SkillHit, SkillManifest, SkillRecord, TaskContext, WorkflowDag,
} from "./types.ts";

export interface ServerOptions {
  skillsDir: string;
  dataDir: string;
  policy?: PolicyConfig;
  embedConfig?: EmbeddingConfig;
  llmConfig?: { baseUrl: string; apiKey: string; model: string };
  reranker?: "heuristic" | "llm";
  serverName?: string;
  // v3：签名验证 / 更新门 / 联邦 registry
  trust?: { mode: "off" | "warn" | "enforce"; keys?: string[] }; // Ed25519 公钥锚（base64 SPKI DER）
  gate?: { testsRequired?: boolean };
  remotes?: { name: string; url: string; keys: string[] }[];
}

export interface SkillContext {
  registry: SkillRegistry;
  ranker: Ranker;
  telemetry: TelemetryStore;
  broker: PermissionBroker;
  grants: Map<string, GrantToken>;
  issueGrant(skillKey: string, granted: Partial<PermissionSet>): GrantToken;
  reindex(): Promise<void>;
  searchAndFit(task: string, ctx: TaskContext, filters?: SearchFilters, topK?: number): Promise<SkillHit[]>;
}

const DEFAULT_POLICY: PolicyConfig = { defaultMutating: "ask", defaultNetwork: "ask", rules: [] };

function str(a: Record<string, JsonValue>, k: string): string {
  const v = a[k];
  return typeof v === "string" ? v : "";
}
function num(a: Record<string, JsonValue>, k: string, dflt: number): number {
  const v = a[k];
  return typeof v === "number" && !Number.isNaN(v) ? v : dflt;
}
function bool(a: Record<string, JsonValue>, k: string): boolean {
  return a[k] === true;
}
function obj(a: Record<string, JsonValue>, k: string): Record<string, JsonValue> {
  const v = a[k];
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>) : {};
}
function ok(structured: JsonValue): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
}
function err(message: string): ToolResult {
  return { content: [{ type: "text", text: "error: " + message }], isError: true };
}
function jsonRes(uri: string, value: unknown): ResourceContent {
  return { uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) };
}
function txtRes(uri: string, text: string): ResourceContent {
  return { uri, mimeType: "text/plain", text };
}

export async function createSkillMcp(opts: ServerOptions): Promise<{ server: McpServer; ctx: SkillContext }> {
  const registry = new SkillRegistry({ skillsDir: opts.skillsDir, dataDir: opts.dataDir });
  const loadErrors = registry.load().errors;
  const recipeStore = new RecipeStore({ path: join(opts.dataDir, "recipes.json") });

  // v3 联邦 registry：从签名 catalog 导入远程 skill（签名验不过 / 拉取失败只警告，不阻塞）
  async function importRemotes(): Promise<string[]> {
    const notes: string[] = [];
    for (const remote of opts.remotes ?? []) {
      try {
        const res = await fetch(remote.url);
        if (!res.ok) { notes.push(`remote ${remote.name}: HTTP ${res.status}`); continue; }
        const catalog = (await res.json()) as { signature?: string; skills?: { manifest?: SkillManifest; files?: Record<string, unknown> }[] };
        if (!Array.isArray(catalog.skills) || typeof catalog.signature !== "string") {
          notes.push(`remote ${remote.name}: malformed catalog`);
          continue;
        }
        const payload = canonicalCatalogPayload(catalog.skills as unknown[]);
        const anchors = remote.keys ?? [];
        if (!anchors.some((k) => verifyHash(k, payload, catalog.signature!))) {
          notes.push(`remote ${remote.name}: catalog signature verification failed`);
          continue;
        }
        let imported = 0;
        let failed = 0;
        for (const s of catalog.skills) {
          if (!s.manifest || typeof s.manifest !== "object") { failed++; continue; }
          const files: Record<string, string> = {};
          if (s.files) for (const [k, v] of Object.entries(s.files)) files[k] = typeof v === "string" ? v : JSON.stringify(v);
          const r = registry.register(s.manifest, files);
          if (r.errors.length === 0) imported++;
          else failed++;
        }
        notes.push(`remote ${remote.name}: imported ${imported} skills (${failed} failed)`);
      } catch (e) {
        notes.push(`remote ${remote.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return notes;
  }

  const remoteNotes = await importRemotes();
  for (const n of remoteNotes) process.stderr.write("[skill-mcp] remote: " + n + "\n");
  // v2：SQLite telemetry；旧 JSONL 数据启动时自动迁移
  const sqlitePath = join(opts.dataDir, "telemetry.sqlite");
  const legacyJsonlPath = join(opts.dataDir, "telemetry.jsonl");
  if (!existsSync(sqlitePath) && existsSync(legacyJsonlPath)) {
    const migrated = TelemetryStore.migrateFromJsonl(legacyJsonlPath, sqlitePath);
    if (migrated > 0) process.stderr.write("[skill-mcp] migrated " + migrated + " telemetry entries from JSONL to SQLite\n");
  }
  const telemetry = new TelemetryStore(sqlitePath);
  const ranker = new Ranker(join(opts.dataDir, "ranker.json"));
  ranker.load();
  const taskClusterer = new TaskClusterer({ path: join(opts.dataDir, "taskclusters.json") });
  taskClusterer.load();
  const broker = new PermissionBroker({ ...DEFAULT_POLICY, ...(opts.policy ?? {}) });
  const grants = new Map<string, GrantToken>();
  const embedder: Embedder = makeEmbedder(opts.embedConfig ?? {});
  const reranker: Reranker =
    opts.reranker === "llm" && opts.llmConfig
      ? new LLMReranker(opts.llmConfig)
      : new HeuristicReranker((k) => ranker.quality(k));
  let bundle: IndexBundle = await buildIndex(registry.list(), embedder);

  async function reindex(): Promise<void> {
    bundle = await buildIndex(registry.list(), embedder);
  }

  async function searchAndFit(task: string, ctx: TaskContext, filters?: SearchFilters, topK = 10): Promise<SkillHit[]> {
    const qv = (await embedder.embed([task]))[0];
    const clusterId = task ? taskClusterer.assign(task) : -1;
    const candidates = await searchSkills({
      query: task, ctx, records: registry.all(), index: bundle.index, embedder, reranker,
      clusters: bundle.clusters, filters, topK: Math.min(topK + 10, 50), rerankTopK: 20,
    });
    return scoreFits(task, ctx, candidates, registry.all(), {
      getStats: (k) => ranker.statsFor(k),
      getClusterStats: (k, c) => ranker.clusterStatsFor(k, c),
      clusterId, taskVector: qv, vectors: bundle.vectors,
    });
  }

  function resolveSkill(ref: string): SkillRecord | null {
    if (registry.get(ref)) return registry.get(ref)!;
    let namePart = ref;
    let ver: string | undefined;
    const at = ref.lastIndexOf("@");
    if (at > 0) { namePart = ref.slice(0, at); ver = ref.slice(at + 1); }
    const parts = namePart.split(":");
    const ns = parts.length === 2 ? parts[0] : "";
    const name = parts.length === 2 ? parts[1] : namePart;
    const candidates = registry.list().filter((r) => r.manifest.name === name && (ns === "" || r.manifest.namespace === ns));
    if (candidates.length === 0) return null;
    if (ver) {
      for (const r of candidates) if (r.manifest.version === ver) return r;
      return null;
    }
    const pool = candidates.filter((r) => r.manifest.status !== "deprecated");
    const usable = pool.length ? pool : candidates;
    usable.sort((a, b) => compareSemver(
      parseSemver(b.manifest.version) || { major: 0, minor: 0, patch: 0, pre: "" },
      parseSemver(a.manifest.version) || { major: 0, minor: 0, patch: 0, pre: "" },
    ));
    return usable[0];
  }

  function evaluateFor(rec: SkillRecord, token?: GrantToken): PermissionEvaluation {
    return broker.evaluate(rec.manifest.permissions, token ? token.granted : undefined);
  }

  function grantFromAsks(asks: { permission: string; detail: string }[]): Partial<PermissionSet> {
    const granted: Partial<PermissionSet> = {};
    for (const q of asks) {
      const p = q.permission as keyof PermissionSet;
      const entry = q.detail.split(": ").slice(1).join(": ");
      const arr = (granted[p] ?? []) as string[];
      arr.push(entry);
      granted[p] = arr;
    }
    return granted;
  }

  function issueGrantFor(rec: SkillRecord, asks: { permission: string; detail: string }[]): GrantToken {
    const t = broker.issueGrant(rec.key, grantFromAsks(asks), 30 * 60 * 1000);
    grants.set(t.id, t);
    return t;
  }

  function light(rec: SkillRecord): Record<string, JsonValue> {
    return {
      key: rec.key, name: rec.manifest.name, namespace: rec.manifest.namespace, version: rec.manifest.version,
      description: rec.manifest.description, category: rec.manifest.category, tags: rec.manifest.tags,
      capabilities: rec.manifest.capabilities, status: rec.manifest.status ?? "active",
      io: rec.manifest.io as unknown as JsonValue,
    };
  }

  function hitJson(h: SkillHit): Record<string, JsonValue> {
    return {
      key: h.key, name: h.name, namespace: h.namespace, version: h.version,
      description: h.description, category: h.category, tags: h.tags, capabilities: h.capabilities,
      status: h.status, fit: Math.round(h.fit * 1000) / 1000,
      fitReasons: h.fitReasons, retrievalScore: h.retrievalScore, qualityScore: h.qualityScore, sem: h.sem, lex: h.lex,
    };
  }

  // ---------------- 9 个工具 ----------------
  async function toolSearch(a: Record<string, JsonValue>): Promise<ToolResult> {
    const query = str(a, "query");
    if (!query) return err("query is required");
    const ctx: TaskContext = { query, ...obj(a, "context") };
    const filters = (a["filters"] ?? undefined) as SearchFilters | undefined;
    const topK = Math.max(1, Math.min(30, Math.floor(num(a, "topK", 10))));
    const hits = await searchAndFit(query, ctx, filters, topK);
    for (const h of hits) ranker.impression(h.key);

    // 准则型 skill（skillType === "rule"）无条件附带在搜索结果之后
    const hitKeys = new Set(hits.map((h) => h.key));
    const ruleRecords = registry.list().filter((r) =>
      r.manifest.skillType === "rule" && !hitKeys.has(r.key) && r.manifest.status !== "deprecated"
    );
    const ruleSnippets = ruleRecords.map((r) => ({
      key: r.key, name: r.manifest.name, namespace: r.manifest.namespace,
      version: r.manifest.version, description: r.manifest.description,
      category: r.manifest.category, tags: r.manifest.tags,
      skillType: "rule" as const,
    }));

    return ok({
      count: hits.length,
      noMatch: hits.length === 0,
      hits: hits.map(hitJson),
      activeRules: ruleSnippets.length > 0 ? ruleSnippets : undefined,
      activeRulesNote: ruleSnippets.length > 0
        ? "以下准则型 Skill 在所有代码生成、重构与审查场景中必须无条件遵守。请先通过 skill_get 获取其 SKILL.md 详细规范。"
        : undefined,
      note: hits.length === 0 ? "no skill matched; consider rephrasing or skill_register" : undefined,
    });
  }

  async function toolInspect(a: Record<string, JsonValue>): Promise<ToolResult> {
    const rec = resolveSkill(str(a, "key") || str(a, "name"));
    if (!rec) return err("skill not found: " + (str(a, "key") || str(a, "name")));
    const deps = registry.resolveDeps(rec);
    return ok({
      key: rec.key, manifest: rec.manifest as unknown as JsonValue, contentHash: rec.contentHash,
      files: Object.keys(rec.files), dependencies: deps.resolved.map((r) => r.key),
      missing: deps.missing, cycles: deps.cycles, conflicts: deps.conflicts,
    });
  }

  async function toolGet(a: Record<string, JsonValue>): Promise<ToolResult> {
    const rec = resolveSkill(str(a, "key") || str(a, "name"));
    if (!rec) return err("skill not found: " + (str(a, "key") || str(a, "name")));
    const deps = registry.resolveDeps(rec);
    const body = rec.files["SKILL.md"];
    return ok({
      key: rec.key, manifest: rec.manifest as unknown as JsonValue,
      skillMd: body ? body : undefined,
      files: Object.keys(rec.files), dependencies: deps.resolved.map((r) => r.key),
      missing: deps.missing, cycles: deps.cycles, conflicts: deps.conflicts,
      note: "follow SKILL.md instructions; use skill_run to execute",
    });
  }

  async function toolPlan(a: Record<string, JsonValue>): Promise<ToolResult> {
    const task = str(a, "task");
    if (!task) return err("task is required");
    const ctx: TaskContext = { query: task, ...obj(a, "context") };
    const llm = opts.llmConfig
      ? async (messages: { role: string; content: string }[]): Promise<string> => {
          const res = await fetch(opts.llmConfig!.baseUrl.replace(/\/$/, "") + "/chat/completions", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer " + opts.llmConfig!.apiKey },
            body: JSON.stringify({ model: opts.llmConfig!.model, messages, temperature: 0 }),
          });
          if (!res.ok) throw new Error("LLM HTTP " + res.status);
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          const text = data.choices?.[0]?.message?.content ?? "";
          if (!text) throw new Error("empty LLM response");
          return text;
        }
      : undefined;
    const dag = await planWorkflow(task, ctx, {
      records: registry.all(),
      search: (q, c) => searchAndFit(q, c, undefined, 8),
      llm,
      getStats: (k) => ranker.statsFor(k),
      recipes: recipeStore.sync(telemetry.all()).promoted,
    });
    return ok({
      id: dag.id, confidence: Math.round(dag.confidence * 1000) / 1000, assumptions: dag.assumptions,
      nodes: dag.nodes.map((n) => {
        const r = registry.get(n.skillKey);
        return {
          id: n.id, skillKey: n.skillKey, name: r?.manifest.name, namespace: r?.manifest.namespace,
          description: r?.manifest.description, inputs: n.inputs as unknown as JsonValue, requiresApproval: n.requiresApproval ?? false,
        };
      }),
      edges: dag.edges,
    });
  }

  async function toolRun(a: Record<string, JsonValue>): Promise<ToolResult> {
    const ref = str(a, "skill");
    const rec = resolveSkill(ref);
    if (!rec) return err("skill not found: " + ref);
    const inputs = obj(a, "inputs");
    const token = a["grantTokenId"] !== undefined ? grants.get(str(a, "grantTokenId")) : undefined;
    if (a["grantTokenId"] !== undefined && !token) return err("grant token not found or expired");
    // v2：grant token 校验（过期 / 归属技能不匹配），先验后用
    if (token) {
      const check = broker.checkGrant(token, rec.manifest.permissions, rec.key);
      if (!check.allowed) return err("grant token invalid: " + check.denied.join("; "));
    }
    let ev = evaluateFor(rec, token);
    if (ev.denied.length > 0) return err("permission denied: " + ev.denied.join("; "));
    let grantTokenId: string | undefined;
    if (ev.asks.length > 0) {
      if (bool(a, "approveAsks")) {
        const t = issueGrantFor(rec, ev.asks);
        grantTokenId = t.id;
        ev = evaluateFor(rec, t);
        if (ev.denied.length > 0) return err("permission denied after grant: " + ev.denied.join("; "));
        if (ev.asks.length > 0) return err("still pending: " + ev.asks.map((x) => x.detail).join("; "));
      } else {
        return ok({
          requiresApproval: true, skill: rec.key, asks: ev.asks,
          hint: "re-call skill_run with approveAsks: true to grant listed permissions and execute (HITL, two-stage)",
        });
      }
    }
    const started = nowMs();
    const timeoutMs = Math.min(num(a, "timeoutMs", rec.manifest.permissions.maxDurationMs), rec.manifest.permissions.maxDurationMs);
    const result = await sandboxRunSkill(rec, inputs, { timeoutMs });
    const latencyMs = nowMs() - started;
    const costCents = Math.round((latencyMs * 0.002 + JSON.stringify(result.output ?? "").length / 1000) * 100) / 100;
    const taskText = str(a, "task");
    const runId = uid();
    const log: InvocationLog = {
      ts: nowMs(), runId, skillKey: rec.key, taskText,
      cluster: taskText ? taskClusterer.assign(taskText) : -1,
      outcome: result.outcome, latencyMs, costCents,
    };
    telemetry.log(log);
    ranker.record(log);
    ranker.selection(rec.key);
    ranker.save();
    return ok({ skill: rec.key, runId, grantTokenId, outcome: result.outcome, output: result.output, error: result.error, latencyMs, costCents, quality: ranker.quality(rec.key) });
  }

  async function toolWorkflow(a: Record<string, JsonValue>): Promise<ToolResult> {
    const dag = a["dag"] as unknown as WorkflowDag | undefined;
    if (!dag || !Array.isArray(dag.nodes)) return err("dag required (use skill_plan output)");
    const inputs = obj(a, "inputs");
    const token = a["grantTokenId"] !== undefined ? grants.get(str(a, "grantTokenId")) : undefined;
    if (token && token.expiresAt < nowMs()) return err("grant token expired");
    const pending: { nodeId: string; skill: string; asks: { permission: string; detail: string }[] }[] = [];
    for (const n of dag.nodes) {
      const rec = registry.get(n.skillKey);
      if (!rec) return err("unknown skill in dag: " + n.skillKey);
      const ev = evaluateFor(rec, token);
      if (ev.denied.length > 0) return err("permission denied: " + n.skillKey + " -> " + ev.denied.join("; "));
      if (ev.asks.length > 0) pending.push({ nodeId: n.id, skill: n.skillKey, asks: ev.asks });
    }
    if (pending.length > 0 && !bool(a, "approveAsks")) {
      return ok({ requiresApproval: true, pending, hint: "re-call workflow_run with approveAsks: true to grant all listed permissions" });
    }
    const issuedGrantIds: string[] = [];
    for (const p of pending) {
      const rec = registry.get(p.skill);
      if (rec) {
        const g = issueGrantFor(rec, p.asks);
        issuedGrantIds.push(g.id);
      }
    }
    const env: ExecEnv = {
      runSkill: async (skillKey, input) => {
        const rec = registry.get(skillKey);
        if (!rec) return { ok: false, output: null, error: "unknown skill: " + skillKey, outcome: "failure" };
        const started = nowMs();
        const result = await sandboxRunSkill(rec, input, { timeoutMs: rec.manifest.permissions.maxDurationMs });
        const latencyMs = nowMs() - started;
        const taskText = str(a, "task");
        const log: InvocationLog = {
          ts: nowMs(), runId: uid(), skillKey, taskText,
          cluster: taskText ? taskClusterer.assign(taskText) : -1,
          outcome: result.outcome, latencyMs, costCents: Math.round(latencyMs * 0.002 * 100) / 100, workflowId: dag.id,
        };
        telemetry.log(log);
        ranker.record(log);
        ranker.selection(skillKey);
        return { ok: result.ok, output: result.output, error: result.error, outcome: result.outcome };
      },
      isApproved: () => true,
      maxRetries: 1,
    };
    const res = await executeWorkflow(dag, inputs, env);
    ranker.save();
    return ok({ ok: res.ok, workflowId: dag.id, grantTokenIds: issuedGrantIds, steps: res.steps as unknown as JsonValue });
  }

  async function toolFeedback(a: Record<string, JsonValue>): Promise<ToolResult> {
    const ref = str(a, "skill");
    const rec = resolveSkill(ref);
    if (!rec) return err("skill not found: " + ref);
    const oc = str(a, "outcome");
    const outcome: InvocationLog["outcome"] = ["success", "failure", "denied", "timeout"].includes(oc) ? (oc as InvocationLog["outcome"]) : "success";
    const beatenBy = str(a, "beatenBy") ? resolveSkill(str(a, "beatenBy")) : null;
    const taskText = str(a, "task");
    // 关联最近一次同 skill 的执行日志（任务文本一致时优先）：共享 runId，反馈作为该次调用的
    // 权威结果覆盖自动记账，保证「一次调用只计一次」而不是执行 + 反馈各计一次
    const windowStart = nowMs() - 30 * 60 * 1000;
    const recent = telemetry.all().filter((l) => l.skillKey === rec.key && l.ts >= windowStart);
    let prev: InvocationLog | undefined;
    if (recent.length > 0) {
      const withTask = taskText ? recent.filter((l) => l.taskText === taskText) : [];
      const pool = withTask.length > 0 ? withTask : recent;
      prev = pool[pool.length - 1];
    }
    const runId = str(a, "runId") || prev?.runId || uid();
    const log: InvocationLog = {
      ts: nowMs(), runId, skillKey: rec.key, taskText,
      cluster: taskText ? taskClusterer.assign(taskText) : -1,
      outcome,
      latencyMs: num(a, "latencyMs", prev ? prev.latencyMs : 0),
      costCents: num(a, "costCents", prev ? prev.costCents : 0),
      rating: num(a, "rating", 0) || undefined,
      beatenBy: beatenBy ? beatenBy.key : undefined,
      workflowId: str(a, "workflowId") || undefined,
    };
    telemetry.log(log);
    ranker.recordFeedback(log, prev);
    ranker.save();
    let alternatives: string[] = [];
    if (outcome === "failure" && taskText) {
      const hits = await searchAndFit(taskText, { query: taskText }, undefined, 3);
      alternatives = hits.filter((h) => h.key !== rec.key).map((h) => h.key);
    }
    return ok({ skill: rec.key, runId, stats: ranker.statsFor(rec.key), quality: ranker.quality(rec.key), alternatives });
  }

  async function toolRegister(a: Record<string, JsonValue>): Promise<ToolResult> {
    const manifest = a["manifest"] as unknown as SkillManifest | undefined;
    if (!manifest || typeof manifest !== "object") return err("manifest required");
    const rawFiles = obj(a, "files");
    const files: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawFiles)) files[k] = typeof v === "string" ? v : JSON.stringify(v);

    const trustMode = opts.trust?.mode ?? "off";
    const trustKeys = opts.trust?.keys ?? [];
    const signature = str(a, "signature");
    const publisherKey = str(a, "publisherKey");

    // 包内容哈希（与 registry 落盘算法一致），签名验证在落盘前完成
    const preview = registry.preview(manifest, files);
    if (preview.errors.length) return err(preview.errors.join("; "));
    const m = preview.manifest;
    const pk = m.namespace + ":" + m.name;

    // v3 签名验证（DESIGN Q8 L4）：enforce 必须验签（锚点或发布者 TOFU 绑定），warn 失败只告警
    let publisher: string | undefined;
    const bound = registry.publisherFor(m.namespace, m.name);
    if (trustMode === "enforce") {
      if (bound) {
        if (publisherKey !== bound) return err(`publisher mismatch for ${pk}: must sign with bound key`);
        if (!verifyHash(bound, preview.hash, signature)) return err(`signature verification failed for ${pk}`);
        publisher = bound;
      } else if (trustKeys.length > 0) {
        if (!publisherKey || !trustKeys.includes(publisherKey)) return err(`publisher key not in trust anchors for ${pk}`);
        if (!verifyHash(publisherKey, preview.hash, signature)) return err(`signature verification failed for ${pk}`);
        publisher = publisherKey;
      } else {
        // 无锚点：TOFU —— 自签名后绑定
        if (!publisherKey || !signature) return err(`signature + publisherKey required (trust mode enforce) for ${pk}`);
        if (!verifyHash(publisherKey, preview.hash, signature)) return err(`signature verification failed for ${pk}`);
        publisher = publisherKey;
      }
    } else if (trustMode === "warn" && signature && publisherKey) {
      if (verifyHash(publisherKey, preview.hash, signature)) {
        publisher = publisherKey;
      } else {
        process.stderr.write(`[skill-mcp] signature warning for ${pk}: verification failed\n`);
      }
    }

    // v3 L4 更新门：版本升级必须自带 tests 并在沙箱通过（DESIGN Q8 L4）
    let testResult: string | undefined;
    if (opts.gate?.testsRequired) {
      const existing = registry.latest(m.namespace, m.name);
      const isBump = !!existing && existing.manifest.version !== m.version;
      if (isBump) {
        const entry = m.tests?.entry ?? (files["tests/run.mjs"] !== undefined ? "tests/run.mjs" : undefined);
        if (!entry) return err(`gated: version bump of ${pk} requires tests (manifest.tests.entry or tests/run.mjs)`);
        const tmp = mkdtempSync(join(tmpdir(), "skill-mcp-gate-"));
        try {
          writeFileSync(join(tmp, "skill.json"), JSON.stringify(m, null, 2), "utf8");
          for (const [p, content] of Object.entries(files)) {
            const target = join(tmp, p);
            ensureDir(join(target, ".."));
            writeFileSync(target, content, "utf8");
          }
          const res = await runSkillTests(tmp, entry, m.tests?.timeoutMs ?? 60_000);
          if (!res.ok) return err(`gated: tests failed for ${pk}: ${res.error ?? "unknown"}`);
          testResult = `tests passed (${res.latencyMs}ms)`;
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }
    }

    const r = registry.register(m, files, publisher);
    if (r.errors.length) return err(r.errors.join("; "));
    await reindex();
    const rec = registry.get(r.key);
    return ok({
      key: r.key, contentHash: rec ? rec.contentHash : "",
      publisher: publisher ? publisher.slice(0, 16) + "..." : undefined,
      verified: trustMode !== "off" ? !!publisher : undefined,
      tests: testResult,
      note: "registered (append-only); restart client or expect tools/list_changed",
    });
  }

  async function toolStats(a: Record<string, JsonValue>): Promise<ToolResult> {
    const ref = str(a, "key");
    if (ref) {
      const rec = resolveSkill(ref);
      if (!rec) return err("skill not found: " + ref);
      const s = ranker.statsFor(rec.key);
      return ok({
        key: rec.key, stats: s, wilson: Math.round(wilsonQuality(s) * 1000) / 1000,
        quality: Math.round(ranker.quality(rec.key) * 1000) / 1000,
        thompson: Math.round(thompsonSample(s) * 1000) / 1000,
      });
    }
    const rows = registry.list()
      .map((r) => {
        const s = ranker.statsFor(r.key);
        return { key: r.key, successes: s.successes, failures: s.failures, elo: s.elo, quality: Math.round(ranker.quality(r.key) * 1000) / 1000 };
      })
      .sort((x, y) => y.quality - x.quality);
    // 描述漂移检测（DESIGN Q8 L1）：高曝光低采纳 -> 标记待 review
    const flaggedForReview: string[] = [];
    for (const r of registry.list()) {
      const s = ranker.statsFor(r.key);
      if (s.impressions >= 5 && s.selections / Math.max(1, s.impressions) < 0.3) flaggedForReview.push(r.key);
    }
    // v3：recipe shadow 全自动 —— 同步晋升/降级，shadow 作为建议暴露
    const sync = recipeStore.sync(telemetry.all());
    return ok({
      total: rows.length, top: rows.slice(0, 10), flaggedForReview,
      recipes: sync.promoted.slice(0, 5), shadowRecipes: sync.shadows.slice(0, 5),
      promoted: sync.promotedCount, demoted: sync.demotedCount,
    });
  }

  const toolSpecs: ToolSpec[] = [
    { name: "skill_search", description: "按任务检索 skill：混合检索（BM25 + 向量 + RRF）+ 五维任务适配打分，返回带理由的候选列表。先做这个再动手。", inputSchema: { type: "object", properties: { query: { type: "string", description: "任务描述" }, context: { type: "object", description: "可用 MCP/权限/项目类型等上下文" }, filters: { type: "object", properties: { categories: { type: "array" }, tags: { type: "array" }, statuses: { type: "array" }, capabilities: { type: "array" }, exclude: { type: "array" } } }, topK: { type: "integer" } }, required: ["query"] } },
    { name: "skill_inspect", description: "查看 skill 的 manifest、依赖树与权限清单（不含正文，成本低）。", inputSchema: { type: "object", properties: { key: { type: "string", description: "key 如 data:csv-stats@1.0.0，或 name 如 csv-stats" }, name: { type: "string" } } } },
    { name: "skill_get", description: "获取 skill 的完整包：manifest + SKILL.md 正文 + 文件清单 + 已解析依赖（渐进披露的正文环节）。", inputSchema: { type: "object", properties: { key: { type: "string" }, name: { type: "string" } } } },
    { name: "skill_plan", description: "把任务规划成 skill 组合的 workflow DAG（分解-检索-组合；无 LLM 时用能力闭包图搜索）。", inputSchema: { type: "object", properties: { task: { type: "string" }, context: { type: "object" } }, required: ["task"] } },
    { name: "skill_run", description: "在权限沙箱中执行单个 skill。权限不足时返回 requiresApproval（两段式 HITL，approveAsks: true 授权后重试）。", inputSchema: { type: "object", properties: { skill: { type: "string" }, inputs: { type: "object" }, task: { type: "string" }, timeoutMs: { type: "integer" }, grantTokenId: { type: "string" }, approveAsks: { type: "boolean" } }, required: ["skill"] } },
    { name: "workflow_run", description: "执行 skill_plan 产出的 DAG：拓扑序数据流、重试、检查点、整链授权。", inputSchema: { type: "object", properties: { dag: { type: "object" }, inputs: { type: "object" }, task: { type: "string" }, grantTokenId: { type: "string" }, approveAsks: { type: "boolean" } }, required: ["dag"] } },
    { name: "skill_feedback", description: "报告执行结果与评分，驱动 bandit/Elo 排名与备选检索（学习闭环；会覆盖同一次 skill_run 的自动记账，不重复计数）。", inputSchema: { type: "object", properties: { skill: { type: "string" }, outcome: { type: "string", enum: ["success", "failure", "denied", "timeout"] }, task: { type: "string" }, runId: { type: "string", description: "skill_run 返回的 runId；缺省时自动关联最近一次同 skill 的执行" }, rating: { type: "integer" }, latencyMs: { type: "number" }, costCents: { type: "number" }, beatenBy: { type: "string" }, workflowId: { type: "string" } }, required: ["skill", "outcome"] } },
    { name: "skill_register", description: "注册或升级 skill（append-only；v3：trust 模式需 Ed25519 签名，gate 模式下升级需自带 tests 过沙箱）。", inputSchema: { type: "object", properties: { manifest: { type: "object" }, files: { type: "object" }, signature: { type: "string", description: "发布者对包内容哈希的 Ed25519 签名（base64）" }, publisherKey: { type: "string", description: "发布者 Ed25519 公钥（base64 SPKI DER）" } }, required: ["manifest"] } },
    { name: "skill_stats", description: "查看 skill 的评价指标：成功率（Wilson）、Elo、质量分、延迟成本，以及挖掘出的 workflow recipe。", inputSchema: { type: "object", properties: { key: { type: "string" } } } },
  ];

  const resourceSpecs: ResourceSpec[] = [
    { uri: "skills://catalog", name: "skill catalog", description: "全部 skill 的轻量索引", mimeType: "application/json" },
    { uri: "skills://recipes", name: "workflow recipes", description: "从执行日志挖掘的高频成功组合", mimeType: "application/json" },
  ];

  async function readResource(uri: string): Promise<ResourceContent[]> {
    if (uri === "skills://catalog") return [jsonRes(uri, { skills: registry.list().map(light) })];
    if (uri === "skills://recipes") return [jsonRes(uri, mineRecipes(telemetry.all(), {}))];
    if (uri.startsWith("skills://manifest/")) {
      const key = decodeURIComponent(uri.slice("skills://manifest/".length));
      const rec = resolveSkill(key);
      return rec ? [jsonRes(uri, rec.manifest)] : [txtRes(uri, "skill not found: " + key)];
    }
    if (uri.startsWith("skills://stats/")) {
      const key = decodeURIComponent(uri.slice("skills://stats/".length));
      const rec = resolveSkill(key);
      return rec ? [jsonRes(uri, ranker.statsFor(rec.key))] : [txtRes(uri, "skill not found: " + key)];
    }
    return [txtRes(uri, "unknown resource")];
  }

  const promptSpecs: PromptSpec[] = [
    {
      name: "skill-briefing",
      description: "启动引导：给定任务，提示 agent 先检索技能再动手",
      arguments: [{ name: "task", required: true }],
    },
  ];

  async function getPrompt(name: string, args: Record<string, string> | undefined): Promise<PromptResult> {
    const task = (args && args.task) || "";
    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Task: " + task + "\n\nBefore doing this task yourself: 1) call skill_search with the task as query; 2) if a suitable skill exists, skill_get it and follow its SKILL.md; 3) execute via skill_run (multi-skill: skill_plan then workflow_run); 4) after execution call skill_feedback with the real outcome so ranking can learn.",
        },
      }],
    };
  }

  const callTool = async (name: string, args: Record<string, JsonValue> | undefined): Promise<ToolResult> => {
    const a = (args ?? {}) as Record<string, JsonValue>;
    switch (name) {
      case "skill_search": return toolSearch(a);
      case "skill_inspect": return toolInspect(a);
      case "skill_get": return toolGet(a);
      case "skill_plan": return toolPlan(a);
      case "skill_run": return toolRun(a);
      case "workflow_run": return toolWorkflow(a);
      case "skill_feedback": return toolFeedback(a);
      case "skill_register": return toolRegister(a);
      case "skill_stats": return toolStats(a);
      default: return err("unknown tool: " + name);
    }
  };

  const server = createMcpServer({
    name: opts.serverName ?? "skill-mcp",
    version: "0.1.0",
    instructions: "Skill-MCP: skills as data. 先 skill_search，再 skill_get，用 skill_run / workflow_run 执行，用 skill_feedback 反馈。权限不足会返回 requiresApproval（两段式 HITL）。",
    tools: toolSpecs,
    callTool,
    resources: resourceSpecs,
    readResource,
    prompts: promptSpecs,
    getPrompt,
    onInitialized: async () => {
      if (loadErrors.length > 0) {
        // 通过 stderr 报告加载问题（不阻塞服务）
        process.stderr.write("[skill-mcp] load warnings: " + loadErrors.slice(0, 10).join(" | ") + "\n");
      }
    },
  });

  const ctx: SkillContext = {
    registry, ranker, telemetry, broker, grants,
    issueGrant: (skillKey, granted) => {
      const t = broker.issueGrant(skillKey, granted, 30 * 60 * 1000);
      grants.set(t.id, t);
      return t;
    },
    reindex,
    searchAndFit,
  };

  return { server, ctx };
}
