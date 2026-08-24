// planning 子系统测试：fit 打分 / 规划（图 + LLM）/ DAG 执行
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFits } from "../src/planning/fit.ts";
import { planWorkflow } from "../src/planning/plan.ts";
import { executeWorkflow } from "../src/planning/executor.ts";
import type { ExecEnv } from "../src/planning/executor.ts";
import type { CandidateScore, JsonValue, RankingStats, SkillHit, SkillManifest, SkillRecord, TaskContext, WorkflowDag } from "../src/types.ts";

function makeManifest(over: Partial<SkillManifest>): SkillManifest {
  return {
    schemaVersion: 1,
    name: "skill",
    namespace: "ns",
    version: "1.0.0",
    description: "desc",
    category: "general",
    tags: [],
    triggers: [],
    keywords: [],
    whenToUse: "",
    whenNotToUse: "",
    useCases: [],
    preconditions: {},
    io: { input: { semanticType: "text" }, output: { semanticType: "text" } },
    capabilities: [],
    consumes: [],
    dependencies: [],
    permissions: { fsRead: [], fsWrite: [], network: [], tools: [], env: [], maxDurationMs: 10000, maxCostCents: 10, mutating: false },
    entrypoint: { kind: "inline", code: "() => null" },
    ...over,
  };
}

function makeRecord(key: string, over: Partial<SkillManifest> = {}): SkillRecord {
  const manifest = makeManifest(over);
  return {
    key,
    manifest,
    contentHash: "h",
    dir: ".",
    installedAt: 0,
    profileText: "",
    files: {},
  };
}

function makeHit(key: string, name: string, fit: number, inType: string, outType: string): SkillHit {
  return {
    key, name, namespace: "ns", version: "1.0.0", description: name, category: "general",
    tags: [], capabilities: [],
    io: { input: { semanticType: inType }, output: { semanticType: outType } },
    status: "active", fit, fitReasons: [], retrievalScore: 0, qualityScore: 0, sem: 0.5, lex: 0.5,
  };
}

const stats: RankingStats = {
  successes: 8, failures: 2, wins: 0, losses: 0, elo: 1500,
  impressions: 10, selections: 5, totalLatencyMs: 0, totalCostCents: 0, lastUsedAt: 0,
};

// ---------- fit ----------
test("scoreFits: precondition gap lowers fit, trigger bonus, whenNotToUse halves fit, llmJudge used, sorted desc", async () => {
  const task = "generate a report from csv data";
  const ctx: TaskContext = { query: task, availableMcpServers: [], availableTools: ["read"], hints: [] };
  const recA = makeRecord("ns:a@1.0.0", {
    name: "csv-a",
    triggers: ["csv"],
    preconditions: { mcpServers: ["fs-server"], tools: ["read"] },
    io: { input: { semanticType: "csv" }, output: { semanticType: "csv" } },
  });
  const recB = makeRecord("ns:b@1.0.0", {
    name: "csv-b",
    whenNotToUse: "do not generate csv data",
    io: { input: { semanticType: "csv" }, output: { semanticType: "csv" } },
  });
  const recC = makeRecord("ns:c@1.0.0", {
    name: "csv-c",
    io: { input: { semanticType: "csv" }, output: { semanticType: "csv" } },
  });
  const records = new Map<string, SkillRecord>([
    [recA.key, recA], [recB.key, recB], [recC.key, recC],
  ]);
  const candidates: CandidateScore[] = [
    { key: recA.key, lex: 0.5, sem: 0.6, fused: 0.55 },
    { key: recB.key, lex: 0.5, sem: 0.6, fused: 0.55 },
    { key: recC.key, lex: 0.5, sem: 0.6, fused: 0.55 },
  ];
  let judgeCalls = 0;
  const llmJudge = async () => { judgeCalls++; return { score: 0.9, reason: "ok" }; };

  const hits = await scoreFits(task, ctx, candidates, records, { getStats: () => stats, llmJudge });

  assert.equal(judgeCalls, 3, "llmJudge mock must be invoked for every candidate");
  const fits = hits.map((h) => h.fit);
  assert.deepEqual(fits, [...fits].sort((a, b) => b - a), "sorted by fit desc");

  const byKey = new Map(hits.map((h) => [h.key, h]));
  const a = byKey.get(recA.key)!;
  const b = byKey.get(recB.key)!;
  const c = byKey.get(recC.key)!;

  // 前提缺口：a 需要 fs-server 但不可用 -> fit 低于无前提的 c（即便有触发词奖励）
  assert.ok(a.fit < c.fit, "precondition gap lowers fit");
  assert.ok(a.fitReasons.some((r) => r.includes("preconditions 1/2 met")));
  assert.ok(a.fitReasons.some((r) => r.includes("trigger hit: csv")));
  // 负向匹配：b 的 whenNotToUse 与任务重叠 -> fit 减半
  assert.ok(Math.abs(b.fit - c.fit * 0.5) < 1e-9, "whenNotToUse overlap halves fit");
  assert.ok(b.fitReasons.some((r) => r.includes("whenNotToUse overlap penalized")));
  // 字段填充
  assert.equal(a.retrievalScore, 0.55, "retrievalScore = candidate.fused");
  assert.equal(a.sem, 0.6, "sem from candidate");
  assert.equal(a.lex, 0.5, "lex from candidate");
  assert.ok(Math.abs(c.qualityScore - 0.49) < 0.01, "qualityScore from wilson quality");
  for (const h of hits) assert.ok(h.fitReasons.length >= 2 && h.fitReasons.length <= 4, "fitReasons 2-4 items");
});

test("scoreFits: per-cluster history ranks skills within the same task cluster", async () => {
  const task = "compute csv statistics";
  const ctx: TaskContext = { query: task };
  const recGood = makeRecord("ns:good@1.0.0", { name: "stats-good" });
  const recBad = makeRecord("ns:bad@1.0.0", { name: "stats-bad" });
  const records = new Map<string, SkillRecord>([[recGood.key, recGood], [recBad.key, recBad]]);
  const candidates: CandidateScore[] = [
    { key: recGood.key, lex: 0.5, sem: 0.5, fused: 0.5 },
    { key: recBad.key, lex: 0.5, sem: 0.5, fused: 0.5 },
  ];
  const clusterId = 4;
  const goodCluster = { ...stats, successes: 10, failures: 0 };
  const badCluster = { ...stats, successes: 0, failures: 10 };
  const hits = await scoreFits(task, ctx, candidates, records, {
    getStats: () => stats,
    getClusterStats: (k) => (k === recGood.key ? goodCluster : badCluster),
    clusterId,
  });
  const byKey = new Map(hits.map((h) => [h.key, h]));
  assert.ok(byKey.get(recGood.key)!.fit > byKey.get(recBad.key)!.fit, "同簇内高成功率 skill 排名更高");
  assert.ok(byKey.get(recGood.key)!.fitReasons.some((r) => r.includes("history(c4)")), "cluster reason recorded");
});

// ---------- plan: graph path ----------
test("planWorkflow graph path composes A -> B -> C chain", async () => {
  const recA = makeRecord("ns:a@1.0.0", { name: "csv-parse", description: "parse csv files", capabilities: ["csv:parsed"], consumes: [] });
  const recB = makeRecord("ns:b@1.0.0", { name: "csv-stats", description: "compute csv statistics", capabilities: ["csv:stats"], consumes: ["csv:parsed"] });
  const recC = makeRecord("ns:c@1.0.0", { name: "report-md", description: "render markdown report", capabilities: ["report:md"], consumes: ["csv:stats"] });
  recA.profileText = "parse csv data into parsed csv rows for analysis";
  recB.profileText = "compute statistics over parsed csv data";
  recC.profileText = "generate a markdown report from csv statistics";
  const records = new Map<string, SkillRecord>([
    [recA.key, recA], [recB.key, recB], [recC.key, recC],
  ]);

  const dag = await planWorkflow("generate a report from csv data", { query: "generate a report from csv data" }, { records });

  assert.deepEqual(dag.nodes.map((n) => n.skillKey), [recA.key, recB.key, recC.key]);
  assert.deepEqual(dag.edges, [["step1", "step2"], ["step2", "step3"]]);
  assert.ok(dag.id.startsWith("plan-"));
  assert.ok(dag.confidence > 0);
});

test("planWorkflow prefers a mined recipe over BFS discovery", async () => {
  const recA = makeRecord("ns:a@1.0.0", { name: "parse", capabilities: ["csv:parsed"], consumes: [] });
  const recB1 = makeRecord("ns:b1@1.0.0", { name: "stats-v1", capabilities: ["csv:stats"], consumes: ["csv:parsed"] });
  const recB2 = makeRecord("ns:b2@1.0.0", { name: "stats-v2", capabilities: ["csv:stats"], consumes: ["csv:parsed"] });
  const recC = makeRecord("ns:c@1.0.0", { name: "report", capabilities: ["report:md"], consumes: ["csv:stats"] });
  recA.profileText = "parse csv data into rows";
  recB1.profileText = "compute statistics over csv rows";
  recB2.profileText = "aggregate statistics over parsed rows";
  recC.profileText = "generate markdown report from statistics";
  const records = new Map<string, SkillRecord>([
    [recA.key, recA], [recB1.key, recB1], [recB2.key, recB2], [recC.key, recC],
  ]);
  // 执行日志挖掘出的 recipe 锁定 A -> B2 -> C（B1 是同类备选但未被历史验证）
  const recipes = [{
    id: "recipe-a-b2-c", chain: [recA.key, recB2.key, recC.key],
    support: 0.8, confidence: 0.95, lift: 2, hits: 10, lastSeenAt: Date.now(),
  }];

  const dag = await planWorkflow("generate a report from csv data", { query: "generate a report from csv data" }, { records, recipes });

  assert.deepEqual(dag.nodes.map((n) => n.skillKey), [recA.key, recB2.key, recC.key], "recipe chain reused");
  assert.deepEqual(dag.edges, [["step1", "step2"], ["step2", "step3"]]);
  assert.ok(dag.assumptions.some((x) => x.includes("reused mined recipe")), "recipe assumption recorded");
  assert.ok(dag.confidence > 0);
});

test("planWorkflow ignores irrelevant recipe and falls back to BFS", async () => {
  const recA = makeRecord("ns:a@1.0.0", { name: "parse", capabilities: ["csv:parsed"], consumes: [] });
  recA.profileText = "parse csv data into rows";
  const records = new Map<string, SkillRecord>([[recA.key, recA]]);
  const recipes = [{
    id: "recipe-x-y", chain: ["ns:missing@1.0.0"],
    support: 1, confidence: 1, lift: 1, hits: 1, lastSeenAt: Date.now(),
  }];
  const dag = await planWorkflow("parse csv data", { query: "parse csv data" }, { records, recipes });
  assert.deepEqual(dag.nodes.map((n) => n.skillKey), [recA.key], "缺失 skill 的 recipe 被跳过，BFS 兜底");
});

// ---------- plan: LLM path ----------
test("planWorkflow LLM path decomposes task, uses search hits, records io assumptions", async () => {
  const recParse = makeRecord("ns:parse@1.0.0", { name: "csv-parse" });
  const recReport = makeRecord("ns:report@1.0.0", { name: "report-md" });
  const records = new Map<string, SkillRecord>([
    [recParse.key, recParse], [recReport.key, recReport],
  ]);
  const llm = async (msgs: { role: string; content: string }[]) => {
    assert.ok(msgs[0].content.includes("steps"), "system prompt asks for steps JSON");
    return '```json\n{"steps":[{"id":"step1","goal":"parse the csv data","hint":"parse csv"},{"id":"step2","goal":"turn stats into a markdown report","hint":"markdown report"}]}\n```';
  };
  const search = async (q: string) => {
    if (q.includes("csv")) return [makeHit(recParse.key, "csv-parse", 0.85, "csv", "csv")];
    return [makeHit(recReport.key, "report-md", 0.9, "md", "report:md")];
  };

  const dag = await planWorkflow("generate a report from csv data", { query: "generate a report from csv data" }, { records, llm, search });

  assert.deepEqual(dag.nodes.map((n) => n.skillKey), [recParse.key, recReport.key]);
  assert.deepEqual(dag.edges, [["step1", "step2"]]);
  // step1 输出 csv、step2 期望 md：IO 不兼容 -> 记录假设
  assert.ok(dag.assumptions.some((x) => x.includes("step2 expects md but step1 outputs csv")), "io incompatibility assumption");
  assert.ok(dag.confidence > 0);
  // 下游输入默认引用前一步输出
  assert.deepEqual(dag.nodes[1].inputs, { input: { step: "step1", path: "" } });
});

test("planWorkflow falls back to graph path when LLM output is not JSON", async () => {
  const recA = makeRecord("ns:a@1.0.0", { name: "csv-parse", capabilities: ["csv:parsed"], consumes: [] });
  recA.profileText = "parse csv data";
  const records = new Map<string, SkillRecord>([[recA.key, recA]]);
  const llm = async () => "sorry, no json here";
  const search = async () => [];

  const dag = await planWorkflow("parse csv data", { query: "parse csv data" }, { records, llm, search });

  assert.deepEqual(dag.nodes.map((n) => n.skillKey), [recA.key]);
  assert.deepEqual(dag.edges, []);
});

// ---------- executor ----------
test("executeWorkflow linear dataflow with literal + dotted/array ValueRefs", async () => {
  const dag: WorkflowDag = {
    id: "plan-t1",
    nodes: [
      { id: "step1", skillKey: "inc", inputs: { x: { literal: 3 } } },
      { id: "step2", skillKey: "inc", inputs: { x: { step: "step1", path: "total" }, y: { step: "step1", path: "list[1]" } } },
      { id: "step3", skillKey: "inc", inputs: { x: { step: "step2", path: "total" } } },
    ],
    edges: [["step1", "step2"], ["step2", "step3"]],
    assumptions: [],
    confidence: 1,
  };
  const received: Record<string, JsonValue>[] = [];
  const env: ExecEnv = {
    runSkill: async (_key, input) => {
      received.push(input);
      const nums = Object.values(input).filter((v): v is number => typeof v === "number");
      return { ok: true, output: { total: nums.reduce((a, b) => a + b, 0) + 1, list: [10, 20, 30] }, outcome: "success" };
    },
  };

  const res = await executeWorkflow(dag, {}, env);

  assert.ok(res.ok);
  assert.deepEqual(res.steps.step1.output, { total: 4, list: [10, 20, 30] });
  assert.equal(res.steps.step2.output.total, 25); // 4 (step1.total) + 20 (step1.list[1]) + 1
  assert.equal(res.steps.step3.output.total, 26);
  assert.deepEqual(received[1], { x: 4, y: 20 }, "dataflow: step2 resolved step1 outputs");
  assert.deepEqual(received[2], { x: 25 }, "dataflow: step3 resolved step2 output");
});

test("executeWorkflow retries failing node once then fails and skips downstream", async () => {
  const dag: WorkflowDag = {
    id: "plan-t2",
    nodes: [
      { id: "s1", skillKey: "ok", inputs: {} },
      { id: "s2", skillKey: "bad", inputs: { v: { step: "s1", path: "" } } },
      { id: "s3", skillKey: "never", inputs: { v: { step: "s2", path: "" } } },
    ],
    edges: [["s1", "s2"], ["s2", "s3"]],
    assumptions: [],
    confidence: 1,
  };
  let badAttempts = 0;
  const env: ExecEnv = {
    runSkill: async (key) => {
      if (key === "bad") { badAttempts++; return { ok: false, output: null, error: "boom", outcome: "failure" }; }
      if (key === "never") throw new Error("must not run");
      return { ok: true, output: { v: 1 }, outcome: "success" };
    },
  };

  const res = await executeWorkflow(dag, {}, env);

  assert.equal(badAttempts, 2, "initial attempt + 1 retry (maxRetries default 1)");
  assert.equal(res.steps.s1.status, "success");
  assert.equal(res.steps.s2.status, "failure");
  assert.equal(res.steps.s2.error, "boom");
  assert.equal(res.steps.s3.status, "skipped");
  assert.ok(!res.ok);
});

test("executeWorkflow runs independent nodes concurrently (layered)", async () => {
  const dag: WorkflowDag = {
    id: "plan-par",
    nodes: [
      { id: "a", skillKey: "slow1", inputs: {} },
      { id: "b", skillKey: "slow2", inputs: {} },
      { id: "c", skillKey: "join", inputs: { x: { step: "a", path: "v" }, y: { step: "b", path: "v" } } },
    ],
    edges: [["a", "c"], ["b", "c"]],
    assumptions: [],
    confidence: 1,
  };
  const ran: string[] = [];
  const env: ExecEnv = {
    runSkill: async (key) => {
      ran.push(key);
      if (key === "join") return { ok: true, output: { v: 99 }, outcome: "success" };
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, output: { v: 7 }, outcome: "success" };
    },
  };
  const t0 = Date.now();
  const res = await executeWorkflow(dag, {}, env);
  const elapsed = Date.now() - t0;
  assert.ok(res.ok);
  assert.equal(res.steps.a.status, "success");
  assert.equal(res.steps.b.status, "success");
  assert.equal(res.steps.c.status, "success");
  assert.deepEqual(ran.slice(0, 2).sort(), ["slow1", "slow2"], "同层独立节点都执行");
  assert.ok(elapsed < 150, "独立节点并行执行 (elapsed=" + elapsed + "ms)");
});

test("executeWorkflow requiresApproval -> needs_approval until approved", async () => {
  const dag: WorkflowDag = {
    id: "plan-t3",
    nodes: [
      { id: "s1", skillKey: "mutating", inputs: {}, requiresApproval: true },
      { id: "s2", skillKey: "mutating2", inputs: {}, requiresApproval: true },
    ],
    edges: [],
    assumptions: [],
    confidence: 1,
  };
  const ran: string[] = [];
  const checkpoints: string[] = [];
  const env: ExecEnv = {
    runSkill: async (key) => { ran.push(key); return { ok: true, output: { done: true }, outcome: "success" }; },
    isApproved: (id) => id === "s2",
    onCheckpoint: (id, status) => { checkpoints.push(id + ":" + status); },
  };

  const res = await executeWorkflow(dag, {}, env);

  assert.equal(res.steps.s1.status, "needs_approval");
  assert.equal(res.steps.s2.status, "success");
  assert.deepEqual(ran, ["mutating2"], "unapproved node must not run");
  assert.deepEqual(checkpoints, ["s1:needs_approval", "s2:success"]);
  assert.ok(res.ok);
});
