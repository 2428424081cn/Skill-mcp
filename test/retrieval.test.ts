// retrieval 子系统测试：倒排 / embedding / 聚类 / rerank / hybrid 漏斗 / 索引器
import { test } from "node:test";
import assert from "node:assert/strict";
import { InvertedIndex } from "../src/retrieval/inverted.ts";
import { HashEmbedder, makeEmbedder } from "../src/retrieval/embeddings.ts";
import { buildClusters, routeClusters } from "../src/retrieval/cluster.ts";
import { HeuristicReranker } from "../src/retrieval/rerank.ts";
import { searchSkills } from "../src/retrieval/hybrid.ts";
import { buildIndex } from "../src/retrieval/indexer.ts";
import { cosine, hashVector, tokenize } from "../src/util.ts";
import type { SkillManifest, SkillRecord } from "../src/types.ts";

function mkRecord(
  name: string,
  desc: string,
  triggers: string[],
  category: string,
  capabilities: string[],
  profileText: string,
): SkillRecord {
  const manifest: SkillManifest = {
    schemaVersion: 1,
    name,
    namespace: "test",
    version: "1.0.0",
    description: desc,
    category,
    tags: [],
    triggers,
    keywords: [],
    whenToUse: "",
    whenNotToUse: "",
    useCases: [],
    preconditions: {},
    io: { input: { semanticType: "text" }, output: { semanticType: "text" } },
    capabilities,
    consumes: [],
    dependencies: [],
    permissions: {
      fsRead: [],
      fsWrite: [],
      network: [],
      tools: [],
      env: [],
      maxDurationMs: 1000,
      maxCostCents: 1,
      mutating: false,
    },
    entrypoint: { kind: "inline", code: "return null;" },
  };
  return {
    key: "test:" + name + "@1.0.0",
    manifest,
    contentHash: "hash",
    dir: "",
    installedAt: 0,
    profileText,
    files: {},
  };
}

async function makeFixture() {
  const records: SkillRecord[] = [];
  const add = (
    name: string,
    desc: string,
    triggers: string[],
    category: string,
    capabilities: string[],
    profileText: string,
  ): SkillRecord => {
    const r = mkRecord(name, desc, triggers, category, capabilities, profileText);
    records.push(r);
    return r;
  };
  const csv = add(
    "csv-parser",
    "Parse CSV data into JSON",
    ["csv"],
    "data",
    ["csv:parse"],
    "parse csv data files into structured json rows",
  );
  add("pdf-extract", "Extract text from PDF files", ["pdf"], "documents", ["pdf:extract"], "read pdf documents and extract text");
  add("image-resize", "Resize images", ["image"], "media", ["image:resize"], "resize image files");
  add("email-send", "Send email messages", ["email"], "comms", ["email:send"], "send email messages");
  add("web-scrape", "Scrape web pages", ["web"], "network", ["web:scrape"], "download web pages and extract content");
  add("json-validate", "Validate JSON documents", ["json"], "data", ["json:validate"], "check json syntax and schema");
  add("sql-query", "Run SQL queries", ["sql"], "data", ["sql:query"], "query sql databases");
  add("markdown-render", "Render markdown", ["markdown"], "documents", ["md:render"], "render markdown to html");
  add("yaml-parse", "Parse YAML files", ["yaml"], "data", ["yaml:parse"], "parse yaml configuration files");
  add("zip-pack", "Pack zip archives", ["zip"], "files", ["zip:pack"], "create zip archives");
  const embedder = new HashEmbedder();
  const bundle = await buildIndex(records, embedder);
  const recordsMap = new Map(records.map((r) => [r.key, r]));
  return { records, csv, embedder, bundle, recordsMap };
}

// ---------- BM25 ----------
test("BM25: doc containing all query terms ranks first", () => {
  const idx = new InvertedIndex();
  idx.add("a", [{ text: "apple banana cherry", weight: 1 }]);
  idx.add("b", [{ text: "apple banana", weight: 1 }]);
  idx.add("c", [{ text: "apple", weight: 1 }]);
  const res = idx.search("apple banana cherry");
  assert.equal(res.length, 3);
  assert.equal(res[0].key, "a");
  assert.ok(res[0].score > res[1].score && res[1].score > res[2].score);
});

test("BM25: name field weight 3 beats description weight 1.2", () => {
  const idx = new InvertedIndex();
  idx.add("name", [{ text: "csv parser", weight: 3 }]);
  idx.add("desc", [{ text: "csv parser", weight: 1.2 }]);
  const res = idx.search("csv parser");
  assert.equal(res.length, 2);
  assert.equal(res[0].key, "name");
});

test("BM25: remove drops the doc and size updates", () => {
  const idx = new InvertedIndex();
  idx.add("a", [{ text: "apple banana", weight: 1 }]);
  idx.add("b", [{ text: "apple", weight: 1 }]);
  assert.equal(idx.size(), 2);
  idx.remove("a");
  assert.equal(idx.size(), 1);
  const res = idx.search("banana");
  assert.equal(res.length, 0);
});

// ---------- Embeddings ----------
test("HashEmbedder: cosine ~1 for same text, lower for different, dim respected", async () => {
  const emb = new HashEmbedder(512);
  assert.equal(emb.dim, 512);
  assert.equal(emb.name, "hash-ngram");
  const vs = await emb.embed(["parse csv data", "parse csv data", "write json report"]);
  assert.equal(vs[0].length, 512);
  assert.ok(cosine(vs[0], vs[1]) > 0.99);
  assert.ok(cosine(vs[0], vs[2]) < 0.9);
});

test("makeEmbedder: defaults to HashEmbedder(2048)", () => {
  const e = makeEmbedder();
  assert.equal(e.name, "hash-ngram");
  assert.equal(e.dim, 2048);
});

// ---------- Hybrid funnel ----------
test("hybrid: finds the csv skill for 'parse csv data'", async () => {
  const fx = await makeFixture();
  const res = await searchSkills({
    query: "parse csv data",
    ctx: { query: "parse csv data" },
    records: fx.recordsMap,
    index: fx.bundle.index,
    embedder: fx.embedder,
    reranker: null,
    clusters: null,
  });
  assert.ok(res.length > 0);
  assert.equal(res[0].key, fx.csv.key);
});

test("hybrid: filters.exclude removes a skill", async () => {
  const fx = await makeFixture();
  const res = await searchSkills({
    query: "parse csv data",
    ctx: { query: "parse csv data" },
    records: fx.recordsMap,
    index: fx.bundle.index,
    embedder: fx.embedder,
    reranker: null,
    clusters: null,
    filters: { exclude: [fx.csv.key] },
  });
  assert.ok(res.length > 0);
  assert.ok(!res.some((c) => c.key === fx.csv.key));
});

test("hybrid: preferredSkills pinned even when excluded", async () => {
  const fx = await makeFixture();
  const res = await searchSkills({
    query: "parse csv data",
    ctx: { query: "parse csv data", preferredSkills: [fx.csv.key], excludeSkills: [fx.csv.key] },
    records: fx.recordsMap,
    index: fx.bundle.index,
    embedder: fx.embedder,
    reranker: null,
    clusters: null,
  });
  assert.ok(res.length > 0);
  assert.equal(res[0].key, fx.csv.key);
});

test("hybrid: missed-case fallback returns something for gibberish query", async () => {
  const fx = await makeFixture();
  const res = await searchSkills({
    query: "zzzqqqzzz",
    ctx: { query: "zzzqqqzzz" },
    records: fx.recordsMap,
    index: fx.bundle.index,
    embedder: fx.embedder,
    reranker: null,
    clusters: null,
  });
  assert.ok(res.length > 0);
});

// ---------- Cluster ----------
test("cluster: returns null for fewer than 300 records", () => {
  const records = Array.from({ length: 50 }, (_, i) => mkRecord("s" + i, "desc", [], "cat", [], "text " + i));
  assert.equal(buildClusters(records), null);
});

test("cluster: 400 records build a model with k>=2, full assignment, working routing", () => {
  const records = Array.from({ length: 400 }, (_, i) => {
    const r = mkRecord("s" + i, "desc " + i, [], "cat" + (i % 5), [], "text " + i);
    r.vector = hashVector(tokenize("skill " + i + " category " + (i % 5)), 64);
    return r;
  });
  const model = buildClusters(records);
  assert.ok(model !== null);
  assert.ok(model.k >= 2);
  const vectorized = records.filter((r) => r.vector).length;
  assert.equal(model.assignment.size, vectorized);
  for (const r of records) assert.ok(model.assignment.has(r.key));
  const qv = hashVector(tokenize("skill 10 category 0"), 64);
  const top = routeClusters(model, qv);
  assert.ok(top.length >= 1);
  for (const c of top) assert.ok(c >= 0 && c < model.k);
});

// ---------- HeuristicReranker ----------
test("HeuristicReranker: trigger-match hit outranks non-match", async () => {
  const hitA = mkRecord("csv-hit", "handles csv", ["csv"], "data", ["csv:parse"], "parse csv files");
  const hitB = mkRecord("other", "does other stuff", ["pdf"], "docs", ["pdf:extract"], "handle pdf files");
  const rk = new HeuristicReranker();
  const items = await rk.rerank("csv", { query: "csv" }, [hitA, hitB]);
  assert.equal(items.length, 2);
  assert.equal(items[0].index, 0);
  assert.ok(items[0].fit > items[1].fit);
  assert.ok(items[0].reasons.length >= 2 && items[0].reasons.length <= 4);
});

test("HeuristicReranker: getQuality influences order", async () => {
  const a = mkRecord("qa", "same signal text", ["same"], "cat", [], "same signal text");
  const b = mkRecord("qb", "same signal text", ["same"], "cat", [], "same signal text");
  const rk = new HeuristicReranker((key: string) => (key.includes("qa") ? 1 : 0));
  const items = await rk.rerank("same", { query: "same" }, [a, b]);
  const byIndex = new Map(items.map((it) => [it.index, it]));
  assert.ok(byIndex.get(0)!.fit > byIndex.get(1)!.fit);
});

// ---------- Indexer ----------
test("indexer: sets record.vector and index.size equals records.length", async () => {
  const records = Array.from({ length: 5 }, (_, i) => mkRecord("r" + i, "desc " + i, ["t" + i], "cat", [], "profile text " + i));
  const embedder = new HashEmbedder(64);
  const bundle = await buildIndex(records, embedder);
  assert.equal(bundle.index.size(), 5);
  assert.equal(bundle.vectors.size, 5);
  assert.equal(bundle.clusters, null);
  for (const r of records) {
    assert.ok(Array.isArray(r.vector));
    assert.equal(r.vector!.length, 64);
  }
});
