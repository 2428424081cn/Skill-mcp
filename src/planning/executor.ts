// DAG 数据流执行器（DESIGN.md Q3 workflow_run）：拓扑序、ValueRef 解析、重试、HITL、检查点
import type { JsonValue, ValueRef, WorkflowDag, WorkflowNode } from "../types.ts";

export interface ExecEnv {
  runSkill: (skillKey: string, input: JsonValue) => Promise<{ ok: boolean; output: JsonValue | null; error?: string; outcome: string }>;
  isApproved?: (nodeId: string) => boolean;
  onCheckpoint?: (nodeId: string, status: string, output?: JsonValue | null) => void;
  maxRetries?: number; // 失败重试次数上限，默认 1
}

export interface StepResult {
  status: "success" | "failure" | "needs_approval" | "skipped";
  output?: JsonValue | null;
  error?: string;
}

const MISSING = Symbol("ref-missing");

// 点分路径 + [i] 数组下标解析（本地 helper）
function getPath(v: JsonValue, path: string): JsonValue | undefined {
  if (path === "" || path === undefined || path === null) return v;
  const parts: string[] = [];
  for (const seg of path.split(".")) {
    const m = /^([^[]*)((\[\d+\])*)$/.exec(seg);
    if (!m) continue;
    if (m[1]) parts.push(m[1]);
    if (m[2]) for (const im of m[2].matchAll(/\[(\d+)\]/g)) parts.push(im[1]);
  }
  let cur: JsonValue = v;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      const i = Number(p);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return undefined;
      cur = cur[i];
    } else {
      const obj = cur as Record<string, JsonValue>;
      if (!Object.prototype.hasOwnProperty.call(obj, p)) return undefined;
      cur = obj[p];
    }
  }
  return cur;
}

// Kahn 拓扑排序（edges: [from, to]）
function kahnTopo(nodes: WorkflowNode[], edges: [string, string][]): string[] {
  const idSet = new Set(nodes.map((n) => n.id));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) { indeg.set(n.id, 0); adj.set(n.id, []); }
  for (const [f, t] of edges) {
    if (!idSet.has(f) || !idSet.has(t) || f === t) continue;
    adj.get(f)!.push(t);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) queue.push(t);
    }
  }
  return order;
}

// ValueRef 解析：literal 原样返回；{step,path} 取对应 step 输出；引用失败/缺失/未执行 -> MISSING
function resolveRef(ref: ValueRef | undefined, steps: Record<string, StepResult>, rootInput: JsonValue): JsonValue | typeof MISSING {
  if (!ref) return MISSING;
  if (ref.literal !== undefined) return ref.literal;
  if (!ref.step) return MISSING;
  if (ref.step === "input") {
    const v = getPath(rootInput, ref.path ?? "");
    return v === undefined ? MISSING : v;
  }
  const st = steps[ref.step];
  if (!st || st.status !== "success") return MISSING;
  const v = getPath(st.output ?? null, ref.path ?? "");
  return v === undefined ? MISSING : v;
}

export async function executeWorkflow(
  dag: WorkflowDag,
  inputs: Record<string, JsonValue>,
  env: ExecEnv,
): Promise<{ ok: boolean; steps: Record<string, StepResult> }> {
  const maxRetries = env.maxRetries ?? 1;
  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  const steps: Record<string, StepResult> = {};

  // 由 ValueRef 推导隐式依赖边，保证被引用的节点先执行
  const edges: [string, string][] = [...dag.edges];
  const edgeSet = new Set(edges.map((e) => e[0] + "\u0000" + e[1]));
  for (const n of dag.nodes) {
    for (const ref of Object.values(n.inputs)) {
      if (ref && ref.step && ref.step !== "input" && ref.step !== n.id && nodeMap.has(ref.step)) {
        const k = ref.step + "\u0000" + n.id;
        if (!edgeSet.has(k)) { edgeSet.add(k); edges.push([ref.step, n.id]); }
      }
    }
  }

  const order = kahnTopo(dag.nodes, edges);
  const unreached = new Set(dag.nodes.map((n) => n.id));
  for (const id of order) unreached.delete(id);

  // 特殊 step "input"：workflow 根输入（优先 inputs.input，否则整个 inputs 对象）
  const rootInput: JsonValue = inputs["input"] !== undefined ? inputs["input"] : (inputs as JsonValue);

  // v2 并发执行：拓扑分层 —— 层内节点并行（Promise.all），层间保持依赖顺序
  const preds = new Map<string, string[]>();
  for (const [f, t] of edges) {
    const list = preds.get(t) ?? [];
    list.push(f);
    preds.set(t, list);
  }
  const level = new Map<string, number>();
  for (const id of order) {
    let lvl = 0;
    for (const pp of preds.get(id) ?? []) {
      const pl = level.get(pp);
      if (pl !== undefined && pl + 1 > lvl) lvl = pl + 1;
    }
    level.set(id, lvl);
  }
  let maxLevel = 0;
  for (const l of level.values()) if (l > maxLevel) maxLevel = l;
  const layers: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const id of order) layers[level.get(id) ?? 0].push(id);

  const runNode = async (nodeId: string): Promise<void> => {
    const node = nodeMap.get(nodeId)!;

    // HITL：requiresApproval 且未获批 -> 挂起，不执行
    if (node.requiresApproval && !(env.isApproved?.(nodeId) ?? false)) {
      steps[nodeId] = { status: "needs_approval" };
      env.onCheckpoint?.(nodeId, "needs_approval", null);
      return;
    }

    const input: Record<string, JsonValue> = {};
    let blocked: string | undefined;
    for (const [k, ref] of Object.entries(node.inputs)) {
      const v = resolveRef(ref, steps, rootInput);
      if (v === MISSING) { blocked = ref?.step ?? k; break; }
      input[k] = v;
    }
    if (blocked !== undefined) {
      steps[nodeId] = { status: "skipped", error: `depends on unavailable step "${blocked}"` };
      env.onCheckpoint?.(nodeId, "skipped", null);
      return;
    }

    // 失败重试：最多 maxRetries 次额外尝试
    let res = await env.runSkill(node.skillKey, input);
    for (let attempt = 0; !res.ok && attempt < maxRetries; attempt++) {
      res = await env.runSkill(node.skillKey, input);
    }
    if (res.ok) {
      steps[nodeId] = { status: "success", output: res.output ?? null };
    } else {
      steps[nodeId] = { status: "failure", error: res.error ?? res.outcome ?? "skill failed", output: res.output ?? null };
    }
    env.onCheckpoint?.(nodeId, steps[nodeId].status, steps[nodeId].output);
  };

  for (const layer of layers) {
    await Promise.all(layer.map((id) => runNode(id)));
  }

  // 环 / 依赖缺失导致无法到达的节点
  for (const id of unreached) {
    steps[id] = { status: "skipped", error: "not reachable (cycle or missing dependency)" };
    env.onCheckpoint?.(id, "skipped", null);
  }

  const statuses = Object.values(steps);
  const ok = !statuses.some((s) => s.status === "failure") && statuses.some((s) => s.status === "success");
  return { ok, steps };
}
