// 评价子系统测试：telemetry 聚合 / Elo dueling / 快照 / ranking 数学 / recipe 挖掘
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ranker, TelemetryStore } from "../src/eval/telemetry.ts";
import { TaskClusterer } from "../src/eval/taskcluster.ts";
import {
  applyFeedback, eloScore, emptyStats, qualityScore, thompsonSample, updateElo, wilsonQuality,
} from "../src/eval/ranking.ts";
import { loadRecipes, mineRecipes, saveRecipes } from "../src/eval/recipes.ts";
import type { InvocationLog, RankingStats, Recipe } from "../src/types.ts";

// 每次调用生成唯一 runId（真实调用均如此）；需要同 runId 覆盖语义的测试显式传入
let runSeq = 0;
function log(partial: Partial<InvocationLog> = {}): InvocationLog {
  return {
    ts: Date.now(), runId: "run-" + (++runSeq), skillKey: "A", taskText: "t", cluster: -1,
    outcome: "success", latencyMs: 10, costCents: 1, ...partial,
  };
}

// 确定性伪随机数（LCG），避免 Thompson 采样测试抖动
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- telemetry ----------

test("telemetry: statsFor aggregates 3 logs correctly", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const store = new TelemetryStore(join(dir, "invocations.jsonl"));
    store.log(log({ skillKey: "A", outcome: "success", latencyMs: 100, costCents: 5, ts: 1000 }));
    store.log(log({ skillKey: "A", outcome: "failure", latencyMs: 200, costCents: 3, ts: 2000 }));
    store.log(log({ skillKey: "A", outcome: "timeout", latencyMs: 300, costCents: 1, ts: 3000 }));
    const a = store.statsFor("A");
    assert.equal(a.successes, 1);
    assert.equal(a.failures, 2); // failure + timeout
    assert.equal(a.totalLatencyMs, 600);
    assert.equal(a.totalCostCents, 9);
    assert.equal(a.lastUsedAt, 3000);
    assert.equal(a.wins, 0);
    assert.equal(a.losses, 0);
    assert.equal(a.elo, 1500); // Elo 由 Ranker 维护，日志不可推导
    assert.equal(store.all().length, 3);
    assert.equal(store.recent(2).length, 2);
    const b = store.statsFor("B");
    assert.equal(b.successes, 0);
    assert.equal(b.failures, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("telemetry: sqlite backend roundtrip, dedupe and jsonl migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const dbPath = join(dir, "invocations.sqlite");
    const store = new TelemetryStore(dbPath);
    store.log(log({ skillKey: "A", outcome: "success", runId: "run-x", ts: 1 }));
    store.log(log({ skillKey: "A", outcome: "failure", runId: "run-x", ts: 2, rating: 2 }));
    store.log(log({ skillKey: "B", outcome: "success", ts: 3 }));
    assert.equal(store.all().length, 3);
    assert.equal(store.recent(2).length, 2);
    const a = store.statsFor("A");
    assert.equal(a.successes, 0, "同 runId 覆盖，不重复计数");
    assert.equal(a.failures, 1);
    store.close();

    const store2 = new TelemetryStore(dbPath);
    assert.equal(store2.all().length, 3, "SQLite 持久化");
    assert.equal(store2.statsFor("B").successes, 1);
    store2.close();

    // JSONL -> SQLite 迁移
    const jsonlPath = join(dir, "legacy.jsonl");
    const legacy = new TelemetryStore(jsonlPath);
    legacy.log(log({ skillKey: "C", outcome: "success", ts: 9 }));
    const migrated = TelemetryStore.migrateFromJsonl(jsonlPath, join(dir, "migrated.sqlite"));
    assert.equal(migrated, 1);
    const mdb = new TelemetryStore(join(dir, "migrated.sqlite"));
    assert.equal(mdb.statsFor("C").successes, 1);
    mdb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("telemetry: statsAll groups all keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const store = new TelemetryStore(join(dir, "invocations.jsonl"));
    store.log(log({ skillKey: "A", outcome: "success", ts: 1 }));
    store.log(log({ skillKey: "A", outcome: "failure", ts: 2 }));
    store.log(log({ skillKey: "B", outcome: "success", ts: 3 }));
    const all = store.statsAll();
    assert.equal(all["A"].successes, 1);
    assert.equal(all["A"].failures, 1);
    assert.equal(all["B"].successes, 1);
    assert.equal(all["B"].failures, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("telemetry: same-runId feedback entry overrides execution (no double count)", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const store = new TelemetryStore(join(dir, "invocations.jsonl"));
    store.log(log({ skillKey: "A", outcome: "success", runId: "run-x", latencyMs: 100, costCents: 5, ts: 1 }));
    store.log(log({ skillKey: "A", outcome: "failure", runId: "run-x", latencyMs: 200, costCents: 8, ts: 2, rating: 1 }));
    const a = store.statsFor("A");
    assert.equal(a.successes, 0);
    assert.equal(a.failures, 1); // 反馈为权威，覆盖执行日志
    assert.equal(a.totalLatencyMs, 200);
    assert.equal(a.totalCostCents, 8);
    assert.equal(a.lastUsedAt, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- taskcluster ----------

test("taskcluster: similar tasks share a cluster, empty text -> -1", () => {
  const tc = new TaskClusterer({ k: 8, dim: 512 });
  const c1 = tc.assign("对 CSV 数据做统计分析");
  const c2 = tc.assign("统计 csv 数据的均值");
  assert.ok(c1 >= 0 && c2 >= 0);
  assert.equal(c1, c2, "相似任务归入同一簇");
  assert.equal(tc.assign(""), -1);
  assert.ok(tc.size >= 1);
});

test("taskcluster: persistence roundtrip keeps cluster assignment", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const p = join(dir, "tc.json");
    const tc = new TaskClusterer({ k: 8, dim: 512, path: p });
    const c = tc.assign("对 CSV 数据做统计分析");
    const tc2 = new TaskClusterer({ k: 8, dim: 512, path: p });
    tc2.load();
    assert.equal(tc2.size, tc.size);
    assert.equal(tc2.assign("统计 csv 数据的均值"), c, "重载后仍归同一簇");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ranker ----------

test("ranker: dueling success A beatenBy B updates wins/losses/elo", () => {
  const ranker = new Ranker();
  ranker.record(log({ skillKey: "A", outcome: "success", beatenBy: "B" }));
  const a = ranker.statsFor("A");
  const b = ranker.statsFor("B");
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 0);
  assert.equal(b.wins, 0);
  assert.equal(b.losses, 1);
  // 同分对局：E=0.5，K=32 -> A +16，B -16
  assert.equal(a.elo, 1516);
  assert.equal(b.elo, 1484);
  assert.ok(qualityScore(a) > qualityScore(b));
});

test("ranker: snapshot save/load roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const path = join(dir, "snapshot.json");
    const r1 = new Ranker(path);
    r1.record(log({ skillKey: "A", outcome: "success", latencyMs: 42, costCents: 3, ts: 99 }));
    r1.impression("A");
    r1.impression("A");
    r1.selection("A");
    r1.save();
    const r2 = new Ranker(path);
    r2.load();
    const a = r2.statsFor("A");
    assert.equal(a.successes, 1);
    assert.equal(a.totalLatencyMs, 42);
    assert.equal(a.totalCostCents, 3);
    assert.equal(a.impressions, 2);
    assert.equal(a.selections, 1);
    assert.ok(r2.quality("A") > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ranker: missing key defaults to elo 1500", () => {
  const ranker = new Ranker();
  const s = ranker.statsFor("ghost");
  assert.equal(s.elo, 1500);
  assert.equal(s.successes, 0);
});

test("ranker: recordFeedback reverts matched execution and re-counts once", () => {
  const ranker = new Ranker();
  const run = log({ skillKey: "A", outcome: "success", runId: "run-x", latencyMs: 100, costCents: 5 });
  ranker.record(run);
  assert.equal(ranker.statsFor("A").successes, 1);
  ranker.recordFeedback(log({ skillKey: "A", outcome: "failure", runId: "run-x", latencyMs: 120, costCents: 6 }), run);
  const a = ranker.statsFor("A");
  assert.equal(a.successes, 0); // 执行计数被撤销，以反馈为准
  assert.equal(a.failures, 1);
  assert.equal(a.totalLatencyMs, 120);
  assert.equal(a.totalCostCents, 6);
});

test("ranker: recordFeedback applies dueling on success", () => {
  const ranker = new Ranker();
  const run = log({ skillKey: "A", outcome: "success", runId: "run-x" });
  ranker.record(run);
  ranker.recordFeedback(log({ skillKey: "A", outcome: "success", runId: "run-x", beatenBy: "B" }), run);
  const a = ranker.statsFor("A");
  assert.equal(a.successes, 1); // 一次调用仍只计一次
  assert.equal(a.wins, 1);
  assert.equal(ranker.statsFor("B").losses, 1);
  assert.equal(a.elo, 1516);
  assert.equal(ranker.statsFor("B").elo, 1484);
});

test("ranker: recordFeedback without matched execution counts as new invocation", () => {
  const ranker = new Ranker();
  ranker.recordFeedback(log({ skillKey: "A", outcome: "success" }));
  assert.equal(ranker.statsFor("A").successes, 1);
});

test("ranker: per-cluster stats tracked alongside global", () => {
  const ranker = new Ranker();
  ranker.record(log({ skillKey: "A", outcome: "success", cluster: 3 }));
  ranker.record(log({ skillKey: "A", outcome: "failure", cluster: 3 }));
  ranker.record(log({ skillKey: "A", outcome: "success", cluster: 5 }));
  assert.equal(ranker.statsFor("A").successes, 2);
  assert.equal(ranker.statsFor("A").failures, 1);
  assert.equal(ranker.clusterStatsFor("A", 3)?.successes, 1);
  assert.equal(ranker.clusterStatsFor("A", 3)?.failures, 1);
  assert.equal(ranker.clusterStatsFor("A", 5)?.successes, 1);
  assert.equal(ranker.clusterStatsFor("A", 9), undefined);
});

test("ranker: recordFeedback reverts cluster counters too", () => {
  const ranker = new Ranker();
  const run = log({ skillKey: "A", outcome: "success", cluster: 3, runId: "run-x" });
  ranker.record(run);
  ranker.recordFeedback(log({ skillKey: "A", outcome: "failure", cluster: 3, runId: "run-x" }), run);
  assert.equal(ranker.statsFor("A").successes, 0);
  assert.equal(ranker.statsFor("A").failures, 1);
  assert.equal(ranker.clusterStatsFor("A", 3)?.successes, 0);
  assert.equal(ranker.clusterStatsFor("A", 3)?.failures, 1);
});

test("ranker: snapshot roundtrip keeps cluster stats", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const path = join(dir, "snap.json");
    const r1 = new Ranker(path);
    r1.record(log({ skillKey: "A", outcome: "success", cluster: 2 }));
    r1.save();
    const r2 = new Ranker(path);
    r2.load();
    assert.equal(r2.statsFor("A").successes, 1);
    assert.equal(r2.clusterStatsFor("A", 2)?.successes, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- ranking math ----------

test("ranking: wilsonQuality / eloScore / qualityScore math", () => {
  const s = emptyStats();
  assert.equal(wilsonQuality(s), 0); // 无样本不虚高
  s.successes = 10;
  const wq = wilsonQuality(s);
  assert.ok(wq > 0.7 && wq < 0.75, "wilson lower bound for 10/10");
  s.elo = 1600;
  const es = eloScore(s);
  assert.ok(es > 0.6 && es < 0.65, "eloScore near 1600");
  const q = qualityScore(s);
  assert.ok(q > 0 && q <= 1);
});

test("ranking: thompsonSample favors high success rate (seeded)", () => {
  const good: RankingStats = { ...emptyStats(), successes: 10, failures: 0 };
  const bad: RankingStats = { ...emptyStats(), successes: 0, failures: 10 };
  const mean = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0) / xs.length;
  const g: number[] = [];
  const bArr: number[] = [];
  const rng = seededRng(42);
  for (let i = 0; i < 200; i++) {
    g.push(thompsonSample(good, rng));
    bArr.push(thompsonSample(bad, rng));
  }
  assert.ok(g.every((x) => x >= 0 && x <= 1));
  assert.ok(bArr.every((x) => x >= 0 && x <= 1));
  assert.ok(mean(g) > mean(bArr), "high-success skill samples higher");
});

test("ranking: applyFeedback counts outcomes", () => {
  const s = emptyStats();
  applyFeedback(s, "success");
  applyFeedback(s, "failure");
  applyFeedback(s, "timeout");
  applyFeedback(s, "denied");
  assert.equal(s.successes, 1);
  assert.equal(s.failures, 2);
  assert.ok(s.lastUsedAt > 0);
});

test("ranking: updateElo moves ratings toward result", () => {
  const w = emptyStats();
  const l = emptyStats();
  updateElo(w, l, 32);
  assert.equal(w.elo, 1516);
  assert.equal(l.elo, 1484);
});

// ---------- recipes ----------

test("recipes: frequent all-success chain mined from 4 workflows", () => {
  const base = 1_700_000_000_000;
  const logs: InvocationLog[] = [];
  for (let w = 0; w < 4; w++) {
    const off = w * 1000;
    logs.push(log({ skillKey: "A", outcome: "success", workflowId: `wf-${w}`, ts: base + off }));
    logs.push(log({ skillKey: "B", outcome: "success", workflowId: `wf-${w}`, ts: base + off + 10 }));
    logs.push(log({ skillKey: "C", outcome: "success", workflowId: `wf-${w}`, ts: base + off + 20 }));
  }
  const recipes = mineRecipes(logs);
  const abc = recipes.find((r) => r.id === "recipe-A-B-C");
  assert.ok(abc, "A-B-C recipe found");
  assert.equal(abc!.support, 1);
  assert.equal(abc!.confidence, 1);
  assert.equal(abc!.hits, 4);
  assert.equal(abc!.lastSeenAt, base + 3 * 1000 + 20);
  const ab = recipes.find((r) => r.id === "recipe-A-B");
  assert.ok(ab, "A-B recipe found");
  assert.equal(ab!.support, 1);
  // 排序：support*confidence 降序
  for (let i = 1; i < recipes.length; i++) {
    const prev = recipes[i - 1].support * recipes[i - 1].confidence;
    const cur = recipes[i].support * recipes[i].confidence;
    assert.ok(prev >= cur, "sorted desc by support*confidence");
  }
});

test("recipes: minSupport filter works", () => {
  const logs: InvocationLog[] = [];
  for (let w = 0; w < 3; w++) {
    const off = w * 100;
    logs.push(log({ skillKey: "A", outcome: "success", workflowId: `w${w}`, ts: off }));
    logs.push(log({ skillKey: "B", outcome: "success", workflowId: `w${w}`, ts: off + 1 }));
  }
  logs.push(log({ skillKey: "X", outcome: "success", workflowId: "w3", ts: 300 }));
  logs.push(log({ skillKey: "Y", outcome: "success", workflowId: "w3", ts: 301 }));
  const all = mineRecipes(logs);
  assert.ok(all.some((r) => r.id === "recipe-A-B"));
  // A-B support = 3/4 = 0.75 < 0.8 -> 被过滤
  const strict = mineRecipes(logs, { minSupport: 0.8 });
  assert.equal(strict.length, 0);
});

test("recipes: logs without workflowId ignored", () => {
  const logs: InvocationLog[] = [
    log({ skillKey: "A", outcome: "success", workflowId: "w1", ts: 1 }),
    log({ skillKey: "B", outcome: "success", workflowId: "w1", ts: 2 }),
    log({ skillKey: "A", outcome: "failure", ts: 3 }), // 无 workflowId
    log({ skillKey: "B", outcome: "failure", ts: 4 }), // 无 workflowId
  ];
  const recipes = mineRecipes(logs);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].id, "recipe-A-B");
  assert.equal(recipes[0].support, 1);
  assert.equal(recipes[0].confidence, 1);
});

test("recipes: failed member breaks all-success chain", () => {
  const logs: InvocationLog[] = [
    log({ skillKey: "A", outcome: "success", workflowId: "w1", ts: 1 }),
    log({ skillKey: "B", outcome: "failure", workflowId: "w1", ts: 2 }),
    log({ skillKey: "A", outcome: "success", workflowId: "w2", ts: 3 }),
    log({ skillKey: "B", outcome: "success", workflowId: "w2", ts: 4 }),
  ];
  const recipes = mineRecipes(logs, { minConfidence: 0 });
  const ab = recipes.find((r) => r.id === "recipe-A-B");
  assert.ok(ab);
  assert.equal(ab!.support, 0.5);    // 2 个 workflow 中只有 1 个全成功
  assert.equal(ab!.confidence, 0.5); // 含 A-B 的 2 个 workflow 中 1 个全成功
});

test("recipes: saveRecipes/loadRecipes roundtrip", () => {
  const dir = mkdtempSync(join(tmpdir(), "skill-mcp-eval-"));
  try {
    const path = join(dir, "recipes.json");
    const recipes: Recipe[] = [
      { id: "recipe-A-B", chain: ["A", "B"], support: 0.5, confidence: 0.8, lift: 1.2, hits: 3, lastSeenAt: 1 },
    ];
    saveRecipes(recipes, path);
    assert.deepEqual(loadRecipes(path), recipes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
