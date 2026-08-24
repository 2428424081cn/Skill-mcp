// Skill-MCP 端到端演示（进程内）：检索 -> 规划 -> 执行 -> 权限 HITL -> 反馈 -> 评价
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";

const { server } = await createSkillMcp({
  skillsDir: join(process.cwd(), "skills"),
  dataDir: join(process.cwd(), "data"),
});

async function call(tool: string, args: Record<string, unknown> = {}) {
  const res = await server.handle({
    jsonrpc: "2.0", id: Math.floor(Math.random() * 100000),
    method: "tools/call", params: { name: tool, arguments: args },
  });
  const r = res as { error?: unknown; result?: { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> } };
  if (r.error) throw new Error(tool + " rpc error: " + JSON.stringify(r.error));
  if (r.result?.isError) throw new Error(tool + " tool error: " + r.result.content[0].text);
  return r.result?.structuredContent ?? {};
}

const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
console.log("== initialize:", JSON.stringify((init as { result: { serverInfo: unknown } }).result.serverInfo));

const tl = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const toolNames = (tl as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
console.log("== tools:", toolNames.join(", "));

const s1 = await call("skill_search", { query: "把 CSV 数据统计后生成 Markdown 报表" });
console.log("== search(CSV报表):", (s1.hits as { key: string; fit: number }[]).map((h) => h.key + " fit=" + h.fit).join(" | "));

const plan = await call("skill_plan", { task: "从 CSV 数据生成 Markdown 报表" });
const dag = plan as { id: string; confidence: number; nodes: { id: string; skillKey: string; inputs: Record<string, unknown> }[]; edges: [string, string][] };
console.log("== plan:", dag.nodes.map((n) => n.skillKey).join(" -> "), "confidence=" + dag.confidence);

const wf = await call("workflow_run", {
  dag: { id: dag.id, nodes: dag.nodes.map((n) => ({ id: n.id, skillKey: n.skillKey, inputs: n.inputs })), edges: dag.edges },
  inputs: { csv: "name,value\na,1\nb,2\nc,3" },
});
console.log("== workflow steps:", JSON.stringify((wf as { steps: Record<string, { status: string; output?: unknown }> }).steps).slice(0, 700));

const denied = await call("skill_run", { skill: "web:fetch-page", inputs: { url: "http://127.0.0.1:9/" } });
console.log("== fetch-page 未授权 -> requiresApproval:", (denied as { requiresApproval: boolean }).requiresApproval, JSON.stringify((denied as { asks: unknown }).asks));

const sum = await call("skill_run", { skill: "text:summarize", inputs: { text: "这是一段很长很长的文本，包含了大量细节内容，我们希望把它压缩成一句话摘要。" }, task: "总结" });
console.log("== summarize output:", JSON.stringify((sum as { output: unknown; latencyMs: number }).output));

const fb = await call("skill_feedback", { skill: "text:summarize", outcome: "success", rating: 5, task: "总结" });
console.log("== feedback stats:", JSON.stringify((fb as { stats: { successes: number; elo: number } }).stats));

const st = await call("skill_stats", {});
console.log("== stats top3:", (st as { top: { key: string; quality: number }[] }).top.slice(0, 3).map((r) => r.key + " q=" + r.quality).join(" | "));
console.log("== recipes:", JSON.stringify((st as { recipes: unknown[] }).recipes));
console.log("DEMO OK");
