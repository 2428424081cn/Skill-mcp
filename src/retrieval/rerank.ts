// 重排器：默认启发式（零成本），可选 LLM 打分（结构化 JSON，DESIGN Q1 L2）
import { clamp01, cosine, hashVector, tokenize } from "../util.ts";
import type { Reranker, RerankItem, SkillRecord, TaskContext } from "../types.ts";

export class HeuristicReranker implements Reranker {
  readonly name = "heuristic";
  private readonly getQuality: ((key: string) => number) | undefined;

  constructor(getQuality?: (key: string) => number) {
    this.getQuality = getQuality;
  }

  async rerank(query: string, ctx: TaskContext, hits: SkillRecord[]): Promise<RerankItem[]> {
    const qTokens = new Set(tokenize(query));
    const qVec = hashVector(tokenize(query));
    const hintTokens = new Set(tokenize((ctx.hints ?? []).join(" ")));
    const items: RerankItem[] = hits.map((r, index) => {
      const m = r.manifest;
      const reasons: string[] = [];

      // 0.30 词法：query 与 task_profile 的哈希向量余弦
      const lex = cosine(qVec, hashVector(tokenize(r.profileText)));
      if (lex > 0.05) reasons.push("lexical match: " + lex.toFixed(2));

      // 0.15 trigger：任一 trigger 的全部 token 都在 query 中出现
      let trigger = 0;
      for (const tr of m.triggers ?? []) {
        const tt = tokenize(tr);
        if (tt.length > 0 && tt.every((t) => qTokens.has(t))) {
          trigger = 1;
          reasons.push("trigger hit: " + tr);
          break;
        }
      }

      // 0.10 category/tag 与 hints 的重叠比例
      const catTagTokens = new Set(tokenize(m.category + " " + (m.tags ?? []).join(" ")));
      let catTag = 0;
      if (hintTokens.size > 0) {
        let overlap = 0;
        for (const t of hintTokens) if (catTagTokens.has(t)) overlap++;
        catTag = overlap / hintTokens.size;
        if (catTag > 0) reasons.push("category match");
      }

      // 0.10 capabilities 与 hints 的重叠比例
      const capTokens = new Set(tokenize((m.capabilities ?? []).join(" ")));
      let capOverlap = 0;
      if (hintTokens.size > 0) {
        let overlap = 0;
        for (const t of hintTokens) if (capTokens.has(t)) overlap++;
        capOverlap = overlap / hintTokens.size;
        if (capOverlap > 0) reasons.push("capability overlap");
      }

      // 0.15 前提满足度：mcpServers / tools 子集检查，缺一项按比例扣分
      const pre = m.preconditions ?? {};
      const needServers = pre.mcpServers ?? [];
      const needTools = pre.tools ?? [];
      const total = needServers.length + needTools.length;
      let preSat = 1;
      if (total > 0) {
        const availServers = new Set(ctx.availableMcpServers ?? []);
        const availTools = new Set(ctx.availableTools ?? []);
        let ok = 0;
        for (const s of needServers) if (availServers.has(s)) ok++;
        for (const t of needTools) if (availTools.has(t)) ok++;
        preSat = ok / total;
        reasons.push("preconditions " + ok + "/" + total + " met");
      }

      // 0.10 质量分（外部注入，如 Wilson 下限）
      const quality = this.getQuality ? this.getQuality(r.key) : 0.5;
      reasons.push("quality " + quality.toFixed(2));

      // 0.10 生命周期状态：active +0.10 / hidden 0 / deprecated -0.05
      let status = 0.1;
      const st = m.status;
      if (st === "hidden") status = 0;
      else if (st === "deprecated") status = -0.05;
      if (st !== undefined && st !== "active") reasons.push("status " + st);

      const fit = clamp01(
        0.3 * lex + 0.15 * trigger + 0.1 * catTag + 0.1 * capOverlap + 0.15 * preSat + 0.1 * quality + 0.1 * status,
      );
      while (reasons.length < 2) reasons.push("fit " + fit.toFixed(2));
      return { index, fit, reasons: reasons.slice(0, 4) };
    });
    items.sort((a, b) => b.fit - a.fit);
    return items;
  }
}

export class LLMReranker implements Reranker {
  readonly name = "llm";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(opts: { baseUrl: string; apiKey: string; model: string }) {
    let b = opts.baseUrl;
    while (b.endsWith("/")) b = b.slice(0, -1);
    this.baseUrl = b;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  async rerank(query: string, ctx: TaskContext, hits: SkillRecord[]): Promise<RerankItem[]> {
    const candidates = hits.map((r, i) => ({
      index: i,
      name: r.manifest.name,
      description: r.manifest.description,
      whenToUse: r.manifest.whenToUse,
      whenNotToUse: r.manifest.whenNotToUse,
    }));
    const res = await fetch(this.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: 'You rank skills for a task. Reply with JSON only: {"rankings":[{"index":0,"fit":0.0,"reasons":["..."]}]}',
          },
          {
            role: "user",
            content: "Task: " + query + "\nCandidates:\n" + JSON.stringify(candidates),
          },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      throw new Error("LLMReranker: HTTP " + res.status + " " + res.statusText);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("LLMReranker: empty chat completion content");
    }
    const parsed = parseJsonObject(content);
    if (!parsed || !Array.isArray(parsed.rankings)) {
      throw new Error("LLMReranker: could not parse rankings JSON from response");
    }
    const items: RerankItem[] = [];
    for (const r of parsed.rankings) {
      if (typeof r !== "object" || r === null) continue;
      const index = (r as { index?: unknown }).index;
      const fit = (r as { fit?: unknown }).fit;
      const reasons = (r as { reasons?: unknown }).reasons;
      if (typeof index !== "number" || index < 0 || index >= hits.length) continue;
      items.push({
        index,
        fit: typeof fit === "number" ? clamp01(fit) : 0,
        reasons: Array.isArray(reasons) ? reasons.map(String) : [],
      });
    }
    items.sort((a, b) => b.fit - a.fit);
    return items;
  }
}

// 容错 JSON 解析：剥掉代码围栏，取第一个 { 到最后一个 } 之间的片段
function parseJsonObject(text: string): { rankings?: unknown } | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    const nl = t.indexOf("\n");
    if (nl >= 0) t = t.slice(nl + 1);
  }
  if (t.endsWith("```")) t = t.slice(0, t.length - 3);
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const v = JSON.parse(t.slice(first, last + 1)) as unknown;
    return typeof v === "object" && v !== null ? (v as { rankings?: unknown }) : null;
  } catch {
    return null;
  }
}
