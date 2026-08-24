// 三段式检索漏斗：L0 确定性过滤 -> L1 双路召回 + RRF -> L2 rerank（DESIGN Q1/Q7）
import { cosine } from "../util.ts";
import type { CandidateScore, ClusterModel, Embedder, Reranker, SearchFilters, SkillRecord, TaskContext } from "../types.ts";
import type { InvertedIndex } from "./inverted.ts";
import { routeClusters } from "./cluster.ts";

export interface SearchInput {
  query: string;
  ctx: TaskContext;
  records: Map<string, SkillRecord>;
  index: InvertedIndex;
  embedder: Embedder;
  reranker: Reranker | null;
  clusters: ClusterModel | null;
  filters?: SearchFilters;
  topK?: number;
  rerankTopK?: number;
  clusterTopK?: number;
}

export async function searchSkills(input: SearchInput): Promise<CandidateScore[]> {
  const {
    query,
    ctx,
    records,
    index,
    embedder,
    reranker,
    clusters,
    filters,
    topK = 10,
    rerankTopK = 20,
    clusterTopK = 2,
  } = input;

  // ---------- Stage 0：确定性过滤（成本约等于 0） ----------
  const preferred = new Set(ctx.preferredSkills ?? []);
  const excluded = new Set([...(ctx.excludeSkills ?? []), ...(filters?.exclude ?? [])]);
  const pool: SkillRecord[] = [];
  for (const r of records.values()) {
    if (preferred.has(r.key)) {
      pool.push(r); // preferredSkills 恒保留
      continue;
    }
    if (excluded.has(r.key)) continue;
    if (filters?.categories && !filters.categories.includes(r.manifest.category)) continue;
    if (filters?.tags && !(r.manifest.tags ?? []).some((t) => filters.tags!.includes(t))) continue;
    if (filters?.statuses && !filters.statuses.includes(r.manifest.status ?? "active")) continue;
    if (filters?.capabilities && !(r.manifest.capabilities ?? []).some((c) => filters.capabilities!.includes(c))) continue;
    pool.push(r);
  }
  const poolKeys = new Set(pool.map((r) => r.key));

  // ---------- Stage 1a：稀疏路（BM25-lite，按最大分归一） ----------
  const lexScores = new Map<string, number>();
  let maxLex = 0;
  for (const h of index.search(query, 200)) {
    if (!poolKeys.has(h.key)) continue;
    lexScores.set(h.key, h.score);
    if (h.score > maxLex) maxLex = h.score;
  }
  const lex = new Map<string, number>();
  for (const [k, s] of lexScores) lex.set(k, maxLex > 0 ? s / maxLex : 0);

  // ---------- Stage 1b：稠密路（向量余弦；大库时用类目路由剪枝，簇外 sem = 0） ----------
  const qv = (await embedder.embed([query]))[0];
  let allowed: Set<string> | null = null;
  if (clusters && pool.length > 300) {
    const routed = new Set(routeClusters(clusters, qv, clusterTopK));
    allowed = new Set<string>();
    for (const [key, ci] of clusters.assignment) if (routed.has(ci)) allowed.add(key);
  }
  const sem = new Map<string, number>();
  for (const r of pool) {
    if (!r.vector || r.vector.length === 0) {
      sem.set(r.key, 0);
      continue;
    }
    if (allowed && !allowed.has(r.key)) {
      sem.set(r.key, 0);
      continue;
    }
    sem.set(r.key, cosine(qv, r.vector));
  }

  // ---------- Stage 2：RRF 融合（k=60），取 rerankTopK（默认 20，上限 50） ----------
  const lexRank = rankOf(lex);
  const semRank = rankOf(sem);
  const fused = new Map<string, number>();
  for (const r of pool) {
    const l = lex.get(r.key) ?? 0;
    const s = sem.get(r.key) ?? 0;
    const lr = lexRank.get(r.key);
    const sr = semRank.get(r.key);
    const rrf = (l > 0 && lr !== undefined ? 1 / (60 + lr) : 0) + (s > 0 && sr !== undefined ? 1 / (60 + sr) : 0);
    fused.set(r.key, rrf);
  }
  const topCands = [...fused.entries()]
    .map(([key, f]) => ({ key, lex: lex.get(key) ?? 0, sem: sem.get(key) ?? 0, fused: f }))
    .filter((c) => c.fused > 0)
    .sort((a, b) => b.fused - a.fused)
    .slice(0, Math.min(50, Math.max(0, rerankTopK)));

  // ---------- Stage 3：rerank（启发式 / LLM），否则用归一化 RRF ----------
  let results: CandidateScore[];
  if (reranker && topCands.length > 0) {
    const hits = topCands.map((c) => records.get(c.key)).filter((r): r is SkillRecord => r !== undefined);
    const items = await reranker.rerank(query, ctx, hits);
    results = items
      .filter((it) => it.index >= 0 && it.index < hits.length)
      .map((it) => {
        const h = hits[it.index];
        const c = topCands[it.index];
        return { key: h.key, lex: c.lex, sem: c.sem, fused: it.fit };
      });
  } else {
    const maxF = topCands.reduce((m, c) => (c.fused > m ? c.fused : m), 0);
    results = topCands.map((c) => ({ key: c.key, lex: c.lex, sem: c.sem, fused: maxF > 0 ? c.fused / maxF : 0 }));
  }
  results.sort((a, b) => b.fused - a.fused);

  // ---------- missed-case 兜底：检索无果时扫一遍池子（DESIGN Q7 漏检清扫） ----------
  if (results.length === 0 && pool.length > 0) {
    const fallback = pool
      .map((r) => {
        const l = lex.get(r.key) ?? 0;
        const s = sem.get(r.key) ?? 0;
        return { key: r.key, lex: l, sem: s, fused: Math.max(l, s) };
      })
      .sort((a, b) => b.fused - a.fused || b.lex - a.lex)
      .slice(0, topK);
    return fallback;
  }

  return results.slice(0, topK);
}

// 分数 Map -> 排名（0 起，按分数降序；并列按 key 字典序保证稳定）
function rankOf(scores: Map<string, number>): Map<string, number> {
  const order = [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<string, number>();
  order.forEach(([k], i) => rank.set(k, i));
  return rank;
}
