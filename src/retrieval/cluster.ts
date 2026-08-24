// k-means-lite 类目路由：粗排阶段把大批 skill 归入簇，检索只进最近簇（DESIGN Q7 两级索引）
import { cosine, dot, l2norm } from "../util.ts";
import type { SkillRecord } from "../types.ts";

export interface ClusterModel {
  k: number;
  centroids: number[][];
  assignment: Map<string, number>;
}

export function buildClusters(records: SkillRecord[], k?: number): ClusterModel | null {
  const keys: string[] = [];
  const vecs: number[][] = [];
  for (const r of records) {
    if (r.vector && r.vector.length > 0) {
      keys.push(r.key);
      vecs.push(r.vector);
    }
  }
  if (records.length < 300 || vecs.length === 0) return null;
  const target = k ?? Math.max(2, Math.ceil(records.length / 150));
  const K = Math.max(1, Math.min(target, vecs.length));

  // spread-out 初始化：先取模长最大的向量，再依次取离已选质心最远的点
  const centroids: number[][] = [];
  const used = new Set<number>();
  let first = 0;
  let bestN = -1;
  for (let i = 0; i < vecs.length; i++) {
    const n2 = dot(vecs[i], vecs[i]);
    if (n2 > bestN) {
      bestN = n2;
      first = i;
    }
  }
  used.add(first);
  centroids.push(l2norm(vecs[first]));
  while (centroids.length < K) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < vecs.length; i++) {
      if (used.has(i)) continue;
      let minSim = Infinity;
      for (const c of centroids) {
        const sim = cosine(vecs[i], c);
        if (sim < minSim) minSim = sim;
      }
      const dist = 1 - minSim;
      if (dist > bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    used.add(bestIdx);
    centroids.push(l2norm(vecs[bestIdx]));
  }

  // k-means：余弦距离最近簇，质心 = l2norm(成员向量均值)，最多 20 轮
  const Kf = centroids.length;
  const assignment = new Map<string, number>();
  const dim = vecs[0].length;
  for (let iter = 0; iter < 20; iter++) {
    const members: number[][] = Array.from({ length: Kf }, () => []);
    let changed = false;
    for (let i = 0; i < vecs.length; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let ci = 0; ci < Kf; ci++) {
        const sim = cosine(vecs[i], centroids[ci]);
        if (sim > bestSim) {
          bestSim = sim;
          best = ci;
        }
      }
      if (assignment.get(keys[i]) !== best) {
        assignment.set(keys[i], best);
        changed = true;
      }
      members[best].push(i);
    }
    const next: number[][] = [];
    for (let ci = 0; ci < Kf; ci++) {
      const mem = members[ci];
      if (mem.length === 0) {
        next.push(centroids[ci]);
        continue;
      }
      const meanVec = new Array<number>(dim).fill(0);
      for (const mi of mem) {
        const v = vecs[mi];
        for (let d = 0; d < dim; d++) meanVec[d] += v[d];
      }
      for (let d = 0; d < dim; d++) meanVec[d] /= mem.length;
      next.push(l2norm(meanVec));
    }
    centroids.length = 0;
    centroids.push(...next);
    if (!changed) break;
  }
  return { k: Kf, centroids, assignment };
}

// 按余弦相似度取最近的 topClusters 个簇（至少 1 个）
export function routeClusters(model: ClusterModel, queryVector: number[], topClusters = 2): number[] {
  const sims = model.centroids
    .map((c, i) => ({ i, sim: cosine(queryVector, c) }))
    .sort((a, b) => b.sim - a.sim);
  const take = Math.max(1, Math.min(topClusters, model.k));
  return sims.slice(0, take).map((s) => s.i);
}
