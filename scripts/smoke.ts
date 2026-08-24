// 快速冒烟（CI 快速门）：启动 -> 检索命中 -> inline 执行成功
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";

const { server, ctx } = await createSkillMcp({
  skillsDir: join(process.cwd(), "skills"),
  dataDir: join(process.cwd(), "data"),
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as { result?: { isError?: boolean; content?: { text?: string }[]; structuredContent?: Record<string, any> } };
  const r = res.result ?? {};
  if (r.isError) throw new Error(name + ": " + (r.content?.[0]?.text ?? "unknown"));
  return r.structuredContent ?? {};
}

const s = await call("skill_search", { query: "CSV 统计", topK: 5 });
if (!(s.hits ?? []).length) throw new Error("search returned no hits");
console.log("search hits:", (s.hits as { key: string }[]).map((h) => h.key).join(", "));
const run = await call("skill_run", { skill: "text:summarize", inputs: { text: "一段文本" }, task: "总结" });
if (run.outcome !== "success") throw new Error("summarize failed: " + String(run.error));
console.log("summarize ok:", JSON.stringify(run.output).slice(0, 80));
ctx.telemetry.close();
console.log("SMOKE OK");
