// 在线排名：Wilson 置信下限、Thompson 采样（Beta 近似）、Elo 双机制（DESIGN Q4）
import type { RankingStats } from "../types.ts";
import { clamp01, wilsonLower } from "../util.ts";

const DAY_MS = 86_400_000;

export function emptyStats(): RankingStats {
  return {
    successes: 0, failures: 0, wins: 0, losses: 0, elo: 1500,
    impressions: 0, selections: 0, totalLatencyMs: 0, totalCostCents: 0, lastUsedAt: 0,
  };
}

// 展示置信度：Wilson 下限（z=1.96），小样本不虚高
export function wilsonQuality(s: RankingStats): number {
  return wilsonLower(s.successes, s.successes + s.failures);
}

// 近似 Gamma 采样：把连续 Gamma(k) 近似为 k 个指数分布之和（Erlang 分布），
// k 取整为整数（k = max(1, round(alpha))）；指数采样用逆变换 -ln(U)。
function gammaSample(k: number, rng: () => number): number {
  let sum = 0;
  for (let i = 0; i < k; i++) sum += -Math.log(Math.max(rng(), Number.EPSILON));
  return sum;
}

// Thompson sampling：Beta(1+successes, 1+failures) 的样本 ≈ X/(X+Y)，X~Gamma(α), Y~Gamma(β)
export function thompsonSample(s: RankingStats, rng: () => number = Math.random): number {
  const alpha = 1 + s.successes;
  const beta = 1 + s.failures;
  const kx = Math.max(1, Math.round(alpha));
  const ky = Math.max(1, Math.round(beta));
  const x = gammaSample(kx, rng);
  const y = gammaSample(ky, rng);
  return x / (x + y);
}

// Elo 更新（K=32）：E = 期望胜率，胜负按 dueling 信号
export function updateElo(winner: RankingStats, loser: RankingStats, k = 32): void {
  const expected = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
  winner.elo += k * (1 - expected);
  loser.elo += k * (0 - expected);
}

// Elo 转 0..1 展示分（相对基准 1500）
export function eloScore(s: RankingStats): number {
  return 1 / (1 + Math.pow(10, (1500 - s.elo) / 400));
}

// 综合质量分：0.6*Wilson + 0.3*Elo + 0.1*recency；recency = exp(-天数/30)，未使用过 -> 0.5
export function qualityScore(s: RankingStats): number {
  const recency = s.lastUsedAt > 0
    ? Math.exp(-Math.max(0, (Date.now() - s.lastUsedAt) / DAY_MS) / 30)
    : 0.5;
  return clamp01(0.6 * wilsonQuality(s) + 0.3 * eloScore(s) + 0.1 * recency);
}

// 反馈落账：success -> successes；failure|timeout -> failures；denied 不计入成败
export function applyFeedback(s: RankingStats, outcome: "success" | "failure" | "denied" | "timeout"): void {
  if (outcome === "success") s.successes++;
  else if (outcome === "failure" || outcome === "timeout") s.failures++;
  s.lastUsedAt = Date.now();
}
