// 任务适配打分（DESIGN.md Q2）：五维加权 fit 计算，产出可解释的 SkillHit 列表
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { clamp01, cosine, hashVector, tokenize, wilsonLower } from "../util.ts";
import { thompsonSample } from "../eval/ranking.ts";
import type { CandidateScore, RankingStats, SkillHit, SkillRecord, TaskContext } from "../types.ts";

export interface FitOptions {
  getStats?: (key: string) => RankingStats;
  getClusterStats?: (key: string, cluster: number) => RankingStats | undefined;
  clusterId?: number;
  taskVector?: number[];
  vectors?: Map<string, number[]>;
  llmJudge?: (task: string, record: SkillRecord) => Promise<{ score: number; reason: string }>;
}

// Wilson 下限作为历史成功率质量分（小样本不虚高）
export function wilsonQuality(stats: RankingStats): number {
  return wilsonLower(stats.successes, stats.successes + stats.failures);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// semanticType 的 token 在任务 token 中的覆盖率（输入/输出两侧平均）
function ioOverlap(semanticType: string, taskTokens: string[]): number {
  const st = tokenize(semanticType);
  if (st.length === 0) return 1; // 类型未知 -> 中性
  const set = new Set(taskTokens);
  const hits = st.filter((t) => set.has(t)).length;
  return hits / st.length;
}

export async function scoreFits(
  task: string,
  ctx: TaskContext,
  candidates: CandidateScore[],
  records: Map<string, SkillRecord>,
  opts?: FitOptions,
): Promise<SkillHit[]> {
  const o = opts ?? {};
  const taskTokens = tokenize(task + " " + (ctx.hints ?? []).join(" "));
  const taskTokenSet = new Set(taskTokens);
  const taskVec = hashVector(taskTokens); // 反例（whenNotToUse）匹配用
  const semWeight = o.llmJudge ? 0.25 : 0.40; // 有 judge 时语义权重让出 0.15
  const hits: SkillHit[] = [];

  for (const c of candidates) {
    const record = records.get(c.key);
    if (!record) continue;
    const m = record.manifest;

    // 1) 语义相似度：向量余弦优先，退化到候选检索分
    let sem = c.sem;
    const vec = o.vectors?.get(c.key);
    if (o.taskVector && vec) sem = cosine(o.taskVector, vec);
    if (!Number.isFinite(sem)) sem = 0;

    // 2) 前提满足度：mcpServers/tools 对比可用清单，文件用 fs.existsSync 检查（envVars 未知 -> 视为满足）
    let preMet = 0;
    let preTotal = 0;
    const availServers = new Set(ctx.availableMcpServers ?? []);
    const availTools = new Set(ctx.availableTools ?? []);
    for (const s of m.preconditions.mcpServers ?? []) { preTotal++; if (availServers.has(s)) preMet++; }
    for (const t of m.preconditions.tools ?? []) { preTotal++; if (availTools.has(t)) preMet++; }
    for (const f of m.preconditions.files ?? []) { preTotal++; if (existsSync(resolve(process.cwd(), f))) preMet++; }
    const pre = preTotal === 0 ? 1 : preMet / preTotal;

    // 3) IO 兼容性：semanticType token 与任务 token 的重叠率
    const io = (ioOverlap(m.io.input.semanticType, taskTokens) + ioOverlap(m.io.output.semanticType, taskTokens)) / 2;

    // 4) 历史成功率（Wilson 下限；任务簇内样本足够时按簇统计 + Thompson 探索/利用）
    const stats = o.getStats?.(c.key);
    const clusterStats = o.clusterId !== undefined && o.clusterId >= 0
      ? o.getClusterStats?.(c.key, o.clusterId)
      : undefined;
    const useCluster = !!clusterStats && clusterStats.successes + clusterStats.failures >= 2;
    const active = useCluster ? clusterStats! : stats;
    let hist = active ? wilsonQuality(active) : 0.5;
    let histReason: string | undefined;
    if (useCluster) {
      const trials = clusterStats!.successes + clusterStats!.failures;
      if (trials >= 3) {
        // 探索/利用：同簇历史 + Thompson 采样注入探索性，新 skill 自动获得曝光机会（DESIGN Q4）
        hist = 0.7 * hist + 0.3 * thompsonSample(clusterStats!);
      }
      histReason = `history(c${o.clusterId}) ${clusterStats!.successes}/${trials}`;
    } else if (stats) {
      histReason = `history ${stats.successes}/${stats.successes + stats.failures}`;
    }

    // 5) LLM judge（可选；失败不致命）
    let judge: number | undefined;
    if (o.llmJudge) {
      try {
        const j = await o.llmJudge(task, record);
        judge = clamp01(typeof j?.score === "number" ? j.score : 0.5);
      } catch {
        judge = 0.5;
      }
    }

    let fit = sem * semWeight + pre * 0.25 + io * 0.15 + hist * 0.20 + (judge !== undefined ? judge * 0.15 : 0);

    // 触发词精确命中 -> 小奖励
    let triggerHit: string | undefined;
    for (const t of m.triggers ?? []) {
      const tt = tokenize(t);
      if (tt.length > 0 && tt.every((x) => taskTokenSet.has(x))) { triggerHit = t; break; }
    }
    if (triggerHit) fit += 0.05;

    // 负向匹配（DESIGN Q2 反例信号）：任务与 whenNotToUse 的向量余弦或 token Jaccard 重叠过高 -> 减半
    const negTokens = tokenize(m.whenNotToUse ?? "");
    const negOverlap = negTokens.length > 0
      ? (cosine(taskVec, hashVector(negTokens)) > 0.3 || jaccard(negTokens, taskTokens) > 0.3)
      : false;
    if (negOverlap) fit *= 0.5;

    fit = clamp01(fit);

    // 可解释的 fitReasons（2-4 条）
    const reasons: string[] = [`semantic ${sem.toFixed(2)}`];
    reasons.push(preTotal === 0 ? "preconditions ok" : `preconditions ${preMet}/${preTotal} met`);
    if (triggerHit) reasons.push(`trigger hit: ${triggerHit}`);
    if (negOverlap) reasons.push("whenNotToUse overlap penalized");
    if (judge !== undefined) reasons.push(`judge ${judge.toFixed(2)}`);
    if (histReason) reasons.push(histReason);
    else reasons.push(`io ${io.toFixed(2)}`);
    const fitReasons = reasons.slice(0, 4);

    hits.push({
      key: record.key,
      name: m.name,
      namespace: m.namespace,
      version: m.version,
      description: m.description,
      category: m.category,
      tags: m.tags ?? [],
      capabilities: m.capabilities ?? [],
      io: m.io,
      status: m.status ?? "active",
      fit,
      fitReasons,
      retrievalScore: c.fused,
      qualityScore: stats ? wilsonQuality(stats) : 0.5,
      sem: c.sem,
      lex: c.lex,
    });
  }

  hits.sort((a, b) => b.fit - a.fit);
  return hits;
}
