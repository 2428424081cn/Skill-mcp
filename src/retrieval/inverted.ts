// 倒排索引（BM25-lite）：字段加权 BM25 检索（DESIGN Q1 L1 稀疏路），零依赖
import { tokenize } from "../util.ts";

export interface FieldDoc {
  text: string;
  weight: number;
}

export class InvertedIndex {
  private readonly k1: number;
  private readonly b: number;
  // term -> (key -> 加权词频 weight * f)
  private postings = new Map<string, Map<string, number>>();
  // key -> 文档长度（token 数）
  private lens = new Map<string, number>();
  private avgdl = 0;

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
  }

  add(key: string, fields: FieldDoc[]): void {
    this.remove(key); // 重复 add 视为替换
    let total = 0;
    for (const field of fields) {
      const tokens = tokenize(field.text);
      total += tokens.length;
      const freq = new Map<string, number>();
      for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
      for (const [term, f] of freq) {
        let m = this.postings.get(term);
        if (!m) {
          m = new Map<string, number>();
          this.postings.set(term, m);
        }
        m.set(key, (m.get(key) ?? 0) + field.weight * f);
      }
    }
    this.lens.set(key, total);
    this.recomputeAvgdl();
  }

  remove(key: string): void {
    if (!this.lens.has(key)) return;
    this.lens.delete(key);
    for (const [term, m] of this.postings) {
      m.delete(key);
      if (m.size === 0) this.postings.delete(term);
    }
    this.recomputeAvgdl();
  }

  private recomputeAvgdl(): void {
    let sum = 0;
    for (const len of this.lens.values()) sum += len;
    this.avgdl = this.lens.size > 0 ? sum / this.lens.size : 0;
  }

  search(query: string, topK = 100): { key: string; score: number }[] {
    const terms = new Set(tokenize(query));
    const scores = new Map<string, number>();
    const n = this.lens.size;
    if (n === 0) return [];
    const avgdl = this.avgdl > 0 ? this.avgdl : 1;
    for (const term of terms) {
      const m = this.postings.get(term);
      if (!m) continue;
      // IDF(t) = ln((N - n + 0.5) / (n + 0.5) + 1)
      const idf = Math.log((n - m.size + 0.5) / (m.size + 0.5) + 1);
      for (const [key, f] of m) {
        const len = this.lens.get(key) ?? 0;
        const tf = (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * len) / avgdl));
        scores.set(key, (scores.get(key) ?? 0) + idf * tf);
      }
    }
    const out = [...scores.entries()].map(([key, score]) => ({ key, score }));
    out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    return out.slice(0, topK);
  }

  size(): number {
    return this.lens.size;
  }
}
