// workflow 组合模式挖掘：从执行日志挖掘高频全成功链（DESIGN Q3 第三轨）
import type { InvocationLog, Recipe } from "../types.ts";
import { readJson, writeJson } from "../util.ts";

export interface MineRecipesOptions {
  minSupport?: number;
  minConfidence?: number;
  maxLength?: number;
}

interface WorkflowEntry {
  key: string;
  ok: boolean;
  ts: number;
}

interface Agg {
  chain: string[];
  appears: number;      // 出现过该链的 workflow 数（无论成败）
  allSuccessWf: number; // 该链全成员成功的 workflow 数
  hits: number;         // 全成功出现次数（同一 workflow 内可多次）
  lastSeenAt: number;
}

export function mineRecipes(logs: InvocationLog[], opts: MineRecipesOptions = {}): Recipe[] {
  const minSupport = opts.minSupport ?? 0.05;
  const minConfidence = opts.minConfidence ?? 0.7;
  const maxLength = opts.maxLength ?? 4;

  // 按 workflowId 分组（无 workflowId 的日志不参与挖掘），组内按 ts 排序成链
  const byWorkflow = new Map<string, WorkflowEntry[]>();
  for (const l of logs) {
    if (!l.workflowId) continue;
    const list = byWorkflow.get(l.workflowId) ?? [];
    list.push({ key: l.skillKey, ok: l.outcome === "success", ts: l.ts });
    byWorkflow.set(l.workflowId, list);
  }
  const workflows = [...byWorkflow.values()].map((ws) => ws.slice().sort((a, b) => a.ts - b.ts));
  const total = workflows.length;
  if (total === 0) return [];
  const globalSuccess = logs.length > 0 ? logs.filter((l) => l.outcome === "success").length / logs.length : 0;

  const agg = new Map<string, Agg>();
  for (const wf of workflows) {
    const maxLen = Math.min(maxLength, wf.length);
    const seen = new Set<string>();      // 本 workflow 已统计过 appears 的链
    const seenSuccess = new Set<string>(); // 本 workflow 已统计过 allSuccessWf 的链
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i + len <= wf.length; i++) {
        const win = wf.slice(i, i + len);
        const ckey = win.map((e) => e.key).join("\u0000");
        let a = agg.get(ckey);
        if (!a) {
          a = { chain: win.map((e) => e.key), appears: 0, allSuccessWf: 0, hits: 0, lastSeenAt: 0 };
          agg.set(ckey, a);
        }
        if (!seen.has(ckey)) {
          seen.add(ckey);
          a.appears++;
        }
        if (win.every((e) => e.ok)) {
          if (!seenSuccess.has(ckey)) {
            seenSuccess.add(ckey);
            a.allSuccessWf++;
          }
          a.hits++;
        }
        const lastTs = win[win.length - 1].ts;
        if (lastTs > a.lastSeenAt) a.lastSeenAt = lastTs;
      }
    }
  }

  const out: Recipe[] = [];
  for (const a of agg.values()) {
    const support = total > 0 ? a.allSuccessWf / total : 0;
    const confidence = a.appears > 0 ? a.allSuccessWf / a.appears : 0;
    const lift = globalSuccess > 0 ? confidence / globalSuccess : 0;
    if (support >= minSupport && confidence >= minConfidence) {
      out.push({
        id: "recipe-" + a.chain.join("-"),
        chain: a.chain,
        support,
        confidence,
        lift,
        hits: a.hits,
        lastSeenAt: a.lastSeenAt,
      });
    }
  }
  out.sort((x, y) => y.support * y.confidence - x.support * x.confidence);
  return out;
}

export function loadRecipes(path: string): Recipe[] {
  return readJson<Recipe[]>(path, []);
}

export function saveRecipes(recipesList: Recipe[], path: string): void {
  writeJson(path, recipesList);
}

// ---------- RecipeStore：shadow -> 正式 全自动晋升/降级（DESIGN Q8 L3 / v3 路线图） ----------
export interface RecipeStoreOptions {
  path?: string;            // 持久化路径（只存正式 recipe）
  minSupport?: number;      // 正式阈值，默认 0.05
  minConfidence?: number;   // 正式阈值，默认 0.7
  shadowMinSupport?: number;    // shadow（建议级）阈值，默认 0.02
  shadowMinConfidence?: number; // shadow 阈值，默认 0.5
  maxLength?: number;       // 链长上限，默认 4
  staleDays?: number;       // 正式 recipe 超过该天数未出现 -> 降级，默认 30
}

export interface RecipeSyncResult {
  promoted: Recipe[];
  shadows: Recipe[];
  promotedCount: number;    // 本轮新晋升数
  demotedCount: number;     // 本轮降级数
}

export class RecipeStore {
  private promoted: Recipe[] = [];
  private shadows: Recipe[] = [];
  private readonly opts: RecipeStoreOptions;

  constructor(opts: RecipeStoreOptions = {}) {
    this.opts = opts;
    this.load();
  }

  load(): void {
    this.promoted = this.opts.path ? loadRecipes(this.opts.path) : [];
  }

  private save(): void {
    if (this.opts.path) saveRecipes(this.promoted, this.opts.path);
  }

  promotedList(): Recipe[] {
    return this.promoted;
  }

  shadowList(): Recipe[] {
    return this.shadows;
  }

  // 从执行日志同步：达正式阈值 -> 自动晋升；掉量或过期 -> 自动降级；其余 -> shadow 建议
  sync(logs: InvocationLog[]): RecipeSyncResult {
    const official = mineRecipes(logs, {
      minSupport: this.opts.minSupport ?? 0.05,
      minConfidence: this.opts.minConfidence ?? 0.7,
      maxLength: this.opts.maxLength ?? 4,
    });
    const all = mineRecipes(logs, {
      minSupport: this.opts.shadowMinSupport ?? 0.02,
      minConfidence: this.opts.shadowMinConfidence ?? 0.5,
      maxLength: this.opts.maxLength ?? 4,
    });
    const officialIds = new Set(official.map((r) => r.id));
    this.shadows = all.filter((r) => !officialIds.has(r.id));

    const cutoff = Date.now() - (this.opts.staleDays ?? 30) * 86_400_000;
    const fresh = official.filter((r) => r.lastSeenAt >= cutoff);
    const prevIds = new Set(this.promoted.map((r) => r.id));
    const promotedCount = fresh.filter((r) => !prevIds.has(r.id)).length;
    const demotedCount = this.promoted.filter((r) => !fresh.some((x) => x.id === r.id)).length;
    this.promoted = fresh;
    this.save();
    return { promoted: this.promoted, shadows: this.shadows, promotedCount, demotedCount };
  }
}
