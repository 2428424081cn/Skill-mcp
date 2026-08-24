// 在线任务聚类（DESIGN Q4）：对任务文本的哈希向量做在线 k-means（MacQueen 增量更新）。
// 目的：让 Thompson sampling / Wilson 历史成功率按 (skill, 任务簇) 统计 —— 同簇任务之间
// 的比较才有意义，否则 1 万个异构任务混在一起的成功率没有任何区分度。
// 持久化到 data/taskclusters.json（质心 + 计数），重启不丢失。
import { cosine, hashVector, l2norm, readJson, tokenize, writeJson } from "../util.ts";

export interface TaskClusterOptions {
  k?: number;       // 簇数上限，默认 8
  dim?: number;     // 向量维度，默认 2048（与 HashEmbedder 一致）
  minSim?: number;  // 与所有簇质心的余弦相似度都低于该值 -> 不归簇（-1），默认 0.30
  path?: string;    // 持久化路径
}

interface ClusterSnapshot { centroids: number[][]; counts: number[] }

export class TaskClusterer {
  readonly k: number;
  readonly dim: number;
  private readonly minSim: number;
  private readonly path?: string;
  private centroids: number[][] = [];
  private counts: number[] = [];
  private updatesSinceSave = 0;

  constructor(opts: TaskClusterOptions = {}) {
    this.k = opts.k ?? 8;
    this.dim = opts.dim ?? 2048;
    this.minSim = opts.minSim ?? 0.3;
    this.path = opts.path;
  }

  get size(): number {
    return this.centroids.length;
  }

  load(): void {
    if (!this.path) return;
    const saved = readJson<ClusterSnapshot>(this.path, { centroids: [], counts: [] });
    this.centroids = (saved.centroids ?? []).filter((c) => Array.isArray(c) && c.length === this.dim);
    this.counts = saved.counts ?? [];
    while (this.counts.length < this.centroids.length) this.counts.push(1);
  }

  save(): void {
    if (this.path) writeJson(this.path, { centroids: this.centroids, counts: this.counts });
  }

  // 任务文本 -> 簇号；空文本或与所有簇都太远 -> -1（不硬归簇）
  assign(text: string): number {
    const tokens = tokenize(text);
    if (tokens.length === 0) return -1;
    const v = hashVector(tokens, this.dim);

    let best = -1;
    let bestSim = -Infinity;
    for (let i = 0; i < this.centroids.length; i++) {
      const sim = cosine(v, this.centroids[i]);
      if (sim > bestSim) { bestSim = sim; best = i; }
    }

    if (best < 0 || bestSim < this.minSim) {
      // 与既有簇都不像：还有空位就开新簇（spread-out 预热），否则判为离群（-1）
      if (this.centroids.length < this.k) {
        this.centroids.push(v);
        this.counts.push(1);
        this.save();
        return this.centroids.length - 1;
      }
      return -1;
    }

    // MacQueen 在线更新：质心向新样本移动 1/(n+1)，再归一化
    const n = this.counts[best] + 1;
    const c = this.centroids[best];
    const next = new Array<number>(this.dim);
    for (let d = 0; d < this.dim; d++) next[d] = c[d] + (v[d] - c[d]) / n;
    this.centroids[best] = l2norm(next);
    this.counts[best] = n;
    this.updatesSinceSave++;
    if (this.updatesSinceSave >= 8) {
      this.updatesSinceSave = 0;
      this.save();
    }
    return best;
  }
}
