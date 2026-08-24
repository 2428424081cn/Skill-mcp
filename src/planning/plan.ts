// 任务 -> WorkflowDag 规划器（DESIGN.md Q3）：LLM 分解 + 检索，或能力闭包图搜索降级
import { clamp01, tokenize, uid } from "../util.ts";
import type {
  JsonSchemaNode, RankingStats, Recipe, SkillHit, SkillRecord,
  TaskContext, ValueRef, WorkflowDag, WorkflowNode,
} from "../types.ts";

export interface PlanOptions {
  records: Map<string, SkillRecord>;
  search?: (query: string, ctx: TaskContext) => Promise<SkillHit[]>;
  llm?: (messages: { role: string; content: string }[]) => Promise<string>;
  getStats?: (key: string) => RankingStats;
  recipes?: Recipe[]; // 执行日志挖掘的高频成功链（DESIGN Q3 第三轨：优先复用）
}

interface LlmStep { id: string; goal: string; hint: string }

export async function planWorkflow(task: string, ctx: TaskContext, opts: PlanOptions): Promise<WorkflowDag> {
  if (opts.llm && opts.search) {
    const dag = await planWithLlm(task, ctx, opts);
    if (dag) return dag; // 返回 null 表示解析失败，降级到图搜索
  }
  return planWithGraph(task, ctx, opts);
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

// 容忍解析 LLM 输出的 JSON：剥代码围栏，取首 { 到末 } 之间的内容
function parseSteps(raw: string): LlmStep[] | null {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    const parsed = JSON.parse(s.slice(first, last + 1)) as { steps?: { id?: unknown; goal?: unknown; hint?: unknown }[] };
    if (!Array.isArray(parsed.steps)) return null;
    const steps = parsed.steps
      .map((st) => ({ id: String(st?.id ?? ""), goal: String(st?.goal ?? ""), hint: String(st?.hint ?? "") }))
      .filter((st) => st.goal !== "" || st.hint !== "");
    return steps.length ? steps : null;
  } catch {
    return null;
  }
}

// 相邻步 IO 兼容：semanticType 相同或 token 有重叠
function ioCompatible(outType: string, inType: string): boolean {
  if (outType === inType) return true;
  const a = tokenize(outType);
  const b = tokenize(inType);
  return a.some((t) => b.includes(t));
}

// 下游输入映射：双方都有 schema 时按字段名取交集；否则整体透传上游输出
function inputsFromPrev(
  prevId: string,
  prevOut: { semanticType: string; schema?: JsonSchemaNode },
  inputIo: { semanticType: string; schema?: JsonSchemaNode },
): Record<string, ValueRef> {
  const inProps = inputIo.schema?.properties ? Object.keys(inputIo.schema.properties) : [];
  const outProps = prevOut.schema?.properties ? Object.keys(prevOut.schema.properties) : [];
  const inputs: Record<string, ValueRef> = {};
  if (inProps.length > 0 && outProps.length > 0) {
    for (const p of inProps) if (outProps.includes(p)) inputs[p] = { step: prevId, path: p };
    if (Object.keys(inputs).length === 0) inputs["input"] = { step: prevId, path: "" };
  } else {
    inputs["input"] = { step: prevId, path: "" };
  }
  return inputs;
}

// 首节点从 workflow 初始 inputs 接线（executor 约定 step === "input" 表示根输入）
function inputsFromRoot(inputIo: { semanticType: string; schema?: JsonSchemaNode }): Record<string, ValueRef> {
  const props = inputIo.schema?.properties ? Object.keys(inputIo.schema.properties) : [];
  const inputs: Record<string, ValueRef> = {};
  if (props.length) for (const p of props) inputs[p] = { step: "input", path: p };
  else inputs["input"] = { step: "input", path: "" };
  return inputs;
}

// ---------- LLM 路径 ----------
async function planWithLlm(task: string, ctx: TaskContext, opts: PlanOptions): Promise<WorkflowDag | null> {
  const skillList = [...opts.records.values()]
    .slice(0, 30)
    .map((r) => `- ${r.key}: ${r.manifest.description}`)
    .join("\n");
  const system = 'You decompose a task into sequential steps. Reply with JSON only: {"steps":[{"id":"step1","goal":"...","hint":"search query"}]}';
  const user = `Task: ${task}\nAvailable skills:\n${skillList || "(none)"}`;
  let raw: string;
  try {
    raw = await opts.llm!([{ role: "system", content: system }, { role: "user", content: user }]);
  } catch {
    return null; // LLM 调用失败 -> 降级
  }
  const steps = parseSteps(raw);
  if (!steps) return null;

  const nodes: WorkflowNode[] = [];
  const edges: [string, string][] = [];
  const assumptions: string[] = [];
  const fits: number[] = [];
  let prevId: string | undefined;
  let prevOutType: string | undefined;
  let prevOutIo: { semanticType: string; schema?: JsonSchemaNode } | undefined;
  let okEdges = 0;
  let totalEdges = 0;

  for (const s of steps) {
    const query = s.hint || s.goal;
    let hits: SkillHit[] = [];
    try { hits = await opts.search!(query, ctx); } catch { hits = []; }
    const hit = hits.find((h) => h.fit >= 0.3);
    if (!hit) {
      assumptions.push(`no skill found for step ${s.id || "?"} ("${s.goal || query}")`);
      continue;
    }
    const nodeId = s.id || `step${nodes.length + 1}`;
    const inputs = prevId
      ? inputsFromPrev(prevId, prevOutIo ?? { semanticType: "any" }, hit.io.input)
      : inputsFromRoot(hit.io.input);
    nodes.push({ id: nodeId, skillKey: hit.key, inputs });
    if (prevId) {
      totalEdges++;
      edges.push([prevId, nodeId]);
      const inType = hit.io.input.semanticType;
      if (prevOutType !== undefined && ioCompatible(prevOutType, inType)) okEdges++;
      else assumptions.push(`${nodeId} expects ${inType || "?"} but ${prevId} outputs ${prevOutType || "?"}`);
    }
    prevId = nodeId;
    prevOutType = hit.io.output.semanticType;
    prevOutIo = hit.io.output;
    fits.push(hit.fit);
  }

  if (nodes.length === 0) {
    return {
      id: "plan-" + uid(),
      nodes: [],
      edges: [],
      assumptions: assumptions.length ? assumptions : ["no skill matched any step"],
      confidence: 0,
    };
  }

  const meanFit = fits.reduce((a, b) => a + b, 0) / fits.length;
  const edgeRatio = totalEdges === 0 ? 0.5 : okEdges / totalEdges;
  const confidence = meanFit * (edgeRatio || 0.5);
  return { id: "plan-" + uid(), nodes, edges, assumptions, confidence };
}

// ---------- 无 LLM 图搜索路径 ----------
function capsKey(caps: Set<string>): string {
  return [...caps].sort().join(",");
}

function isSubset(need: Set<string>, have: Set<string>): boolean {
  for (const c of need) if (!have.has(c)) return false;
  return true;
}

function consumesCovered(consumes: string[], caps: Set<string>): boolean {
  return consumes.every((c) => caps.has(c));
}

function planWithGraph(task: string, ctx: TaskContext, opts: PlanOptions): WorkflowDag {
  const dagId = "plan-" + uid();
  const skills = [...opts.records.values()];
  const assumptions: string[] = [];
  if (skills.length === 0) {
    return { id: dagId, nodes: [], edges: [], assumptions: ["no skills available"], confidence: 0 };
  }

  const taskTokens = tokenize(task);
  const keyToSkill = new Map(skills.map((r) => [r.key, r]));

  // 顺序链 -> 节点/边（首节点接根输入，后续节点接前驱输出）
  const chainToNodes = (chain: string[]): { nodes: WorkflowNode[]; edges: [string, string][] } => {
    const nodes: WorkflowNode[] = [];
    const edges: [string, string][] = [];
    let prevId: string | undefined;
    for (let si = 0; si < chain.length; si++) {
      const skill = keyToSkill.get(chain[si]);
      if (!skill) continue;
      const nodeId = `step${nodes.length + 1}`;
      const prevSkill = si > 0 ? keyToSkill.get(chain[si - 1]) : undefined;
      const inputs = prevId
        ? inputsFromPrev(prevId, prevSkill ? prevSkill.manifest.io.output : { semanticType: "any" }, skill.manifest.io.input)
        : inputsFromRoot(skill.manifest.io.input);
      nodes.push({ id: nodeId, skillKey: chain[si], inputs });
      if (prevId) edges.push([prevId, nodeId]);
      prevId = nodeId;
    }
    return { nodes, edges };
  };

  // fit-ish 分：1/(1+jaccard)，jaccard 越小（越相关）分越高
  // 相关性打分：task 与 profile 的 token-Jaccard 越高越好 + trigger 精确命中加成
  const scoreOf = (r: SkillRecord): number => {
    const j = jaccard(taskTokens, tokenize(r.profileText ?? ""));
    let bonus = 0;
    for (const t of r.manifest.triggers ?? []) {
      const tt = tokenize(t);
      if (tt.length > 0 && tt.every((w) => taskTokens.includes(w))) { bonus = 0.25; break; }
    }
    return Math.min(1, j + bonus);
  };

  // 起点能力：{input} + hint 中能命中某个 capability 的 token 对应的 capability
  const allCaps = new Set<string>();
  for (const r of skills) for (const c of r.manifest.capabilities ?? []) allCaps.add(c);
  const start = new Set<string>(["input"]);
  for (const h of ctx.hints ?? []) {
    for (const t of tokenize(h)) {
      for (const c of allCaps) if (c.includes(t)) start.add(c);
    }
  }

  // 目标能力：token-Jaccard 最高的 top-3 skill 的能力并集
  const ranked = [...skills].sort((a, b) => scoreOf(b) - scoreOf(a));
  const goals = new Set<string>();
  for (const r of ranked.slice(0, 3)) for (const c of r.manifest.capabilities ?? []) goals.add(c);

  // 第三轨（DESIGN Q3）：优先复用执行日志挖掘出的 recipe —— 链完整、能力闭合且与任务相关时直接物化
  const recipePool = (opts.recipes ?? []).slice().sort((a, b) => b.confidence * b.support - a.confidence * a.support);
  for (const rp of recipePool) {
    if (rp.chain.length === 0 || !rp.chain.every((k) => keyToSkill.has(k))) continue;
    const first = keyToSkill.get(rp.chain[0])!;
    if (!consumesCovered(first.manifest.consumes ?? [], start)) continue;
    const caps = new Set(start);
    for (const k of rp.chain) for (const c of keyToSkill.get(k)!.manifest.capabilities ?? []) caps.add(c);
    if (!isSubset(goals, caps)) continue;
    const rel = rp.chain.reduce((a, k) => a + scoreOf(keyToSkill.get(k)!), 0) / rp.chain.length;
    if (rel < 0.05) continue;
    const { nodes, edges } = chainToNodes(rp.chain);
    return {
      id: dagId, nodes, edges,
      assumptions: [`reused mined recipe ${rp.id} (confidence ${rp.confidence.toFixed(2)})`],
      confidence: clamp01(rp.confidence * rel),
    };
  }

  // BFS 能力闭包搜索：每层偏好 1/(1+jaccard) 更高的 skill（最多 8 步）
  const visited = new Set<string>();
  const queue: { caps: Set<string>; seq: string[] }[] = [{ caps: start, seq: [] }];
  visited.add(capsKey(start));
  let bestSeq: string[] | null = null;
  while (queue.length > 0) {
    const state = queue.shift()!;
    if (isSubset(goals, state.caps)) { bestSeq = state.seq; break; }
    if (state.seq.length >= 8) continue;
    const applicable = skills
      .filter((r) => !state.seq.includes(r.key))
      .filter((r) => consumesCovered(r.manifest.consumes ?? [], state.caps))
      .map((r) => ({ r, added: (r.manifest.capabilities ?? []).filter((c) => !state.caps.has(c)) }))
      .filter((x) => x.added.length > 0)
      .sort((a, b) => scoreOf(b.r) - scoreOf(a.r));
    for (const { r, added } of applicable) {
      const next = new Set(state.caps);
      for (const c of added) next.add(c);
      const k = capsKey(next);
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push({ caps: next, seq: [...state.seq, r.key] });
    }
  }

  if (bestSeq === null) {
    // 找不到能力路径：退化为单节点 DAG（选相关性最高的 skill）
    const best = ranked[0];
    assumptions.push(`no capability path found; using best single skill "${best?.key}"`);
    if (!best) return { id: dagId, nodes: [], edges: [], assumptions, confidence: 0 };
    return { id: dagId, nodes: [{ id: "step1", skillKey: best.key, inputs: inputsFromRoot(best.manifest.io.input) }], edges: [], assumptions, confidence: 0 };
  }
  if (bestSeq.length === 0) {
    // 起点已覆盖全部目标，无需 skill
    return { id: dagId, nodes: [], edges: [], assumptions: ["inputs already satisfy all goals"], confidence: 1 };
  }

  // 顺序节点 + 顺序边 + 下游输入映射
  const { nodes, edges } = chainToNodes(bestSeq);
  const confidence = clamp01(
    bestSeq.reduce((a, k) => a + (keyToSkill.get(k) ? scoreOf(keyToSkill.get(k)!) : 0), 0) / bestSeq.length,
  );
  return { id: dagId, nodes, edges, assumptions, confidence };
}
