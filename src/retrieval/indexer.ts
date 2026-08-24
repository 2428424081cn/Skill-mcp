// 索引器：倒排 + 向量 + 类目聚类（DESIGN Q7 两级索引；Q1 合成字段加权）
import { InvertedIndex } from "./inverted.ts";
import { buildClusters } from "./cluster.ts";
import type { ClusterModel } from "./cluster.ts";
import type { Embedder, SkillRecord } from "../types.ts";

export interface IndexBundle {
  index: InvertedIndex;
  vectors: Map<string, number[]>;
  clusters: ClusterModel | null;
}

export async function buildIndex(records: SkillRecord[], embedder: Embedder): Promise<IndexBundle> {
  const index = new InvertedIndex();
  const vectors = new Map<string, number[]>();
  const embeddings = await embedder.embed(records.map((r) => r.profileText));
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const m = r.manifest;
    index.add(r.key, [
      { text: m.name, weight: 3 },
      { text: (m.triggers ?? []).join(" "), weight: 2.5 },
      { text: (m.keywords ?? []).join(" "), weight: 2 },
      { text: (m.tags ?? []).join(" "), weight: 1.5 },
      { text: m.category, weight: 2 },
      { text: m.description, weight: 1.2 },
      { text: (m.useCases ?? []).map((u) => u.task).join(" "), weight: 1.5 },
      { text: m.whenToUse, weight: 1 },
    ]);
    const v = embeddings[i];
    vectors.set(r.key, v);
    r.vector = v; // 写回缓存
  }
  const clusters = buildClusters(records);
  return { index, vectors, clusters };
}
