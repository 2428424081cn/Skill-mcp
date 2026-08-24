// 可插拔 embedder：默认零依赖 hashing-ngram 向量，可选 OpenAI 兼容 API（DESIGN Q1 L1 稠密路）
import { hashVector, tokenize } from "../util.ts";
import type { Embedder } from "../types.ts";

export interface EmbeddingConfig {
  provider?: "hash" | "openai-compat";
  openai?: { baseUrl?: string; apiKey?: string; model?: string };
  dim?: number;
}

export class HashEmbedder implements Embedder {
  readonly name = "hash-ngram";
  readonly dim: number;

  constructor(dim = 2048) {
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashVector(tokenize(t), this.dim));
  }
}

export class OpenAICompatEmbedder implements Embedder {
  readonly name = "openai-compat";
  readonly dim: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { baseUrl: string; apiKey: string; model: string; dim?: number }) {
    let b = opts.baseUrl;
    while (b.endsWith("/")) b = b.slice(0, -1);
    this.baseUrl = b;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.dim = opts.dim ?? 0;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.baseUrl + "/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      const detail = await readBody(res);
      throw new Error("OpenAICompatEmbedder: HTTP " + res.status + " " + res.statusText + (detail ? ": " + detail : ""));
    }
    const data = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    const byIndex = new Map<number, number[]>();
    for (const item of data.data ?? []) {
      if (typeof item.index === "number" && Array.isArray(item.embedding)) byIndex.set(item.index, item.embedding);
    }
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const v = byIndex.get(i);
      if (!v) throw new Error("OpenAICompatEmbedder: missing embedding for input index " + i);
      out.push(v);
    }
    return out;
  }
}

async function readBody(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 300);
  } catch {
    return "";
  }
}

export function makeEmbedder(config?: EmbeddingConfig): Embedder {
  const o = config?.openai;
  if (config?.provider === "openai-compat" && o?.baseUrl && o.apiKey && o.model) {
    return new OpenAICompatEmbedder({ baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model, dim: config.dim });
  }
  return new HashEmbedder(config?.dim ?? 2048);
}
