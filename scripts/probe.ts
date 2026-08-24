// 进程内诊断探针：初始化 -> 工具清单 -> 检索 -> 统计 -> catalog 资源（不依赖 MCP 客户端）
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";

const { server, ctx } = await createSkillMcp({
  skillsDir: join(process.cwd(), "skills"),
  dataDir: join(process.cwd(), "data"),
});

async function rpc(method: string, params?: Record<string, unknown>): Promise<Record<string, any>> {
  const res = (await server.handle({ jsonrpc: "2.0", id: 1, method, params })) as { result?: Record<string, any>; error?: unknown };
  if (res.error) throw new Error(method + " -> " + JSON.stringify(res.error));
  return res.result ?? {};
}

const init = await rpc("initialize", {});
console.log("server:", JSON.stringify(init.serverInfo));
const list = await rpc("tools/list");
console.log("tools:", (list.tools as { name: string }[]).map((x) => x.name).join(", "));
const search = await rpc("tools/call", { name: "skill_search", arguments: { query: "CSV 统计报表", topK: 3 } });
const sc = (search as { structuredContent?: { hits?: { key: string; fit: number }[] } }).structuredContent ?? {};
console.log("search top3:", (sc.hits ?? []).map((h) => `${h.key} fit=${h.fit}`).join(" | "));
const stats = await rpc("tools/call", { name: "skill_stats", arguments: {} });
console.log("stats total:", (stats as { structuredContent?: { total: number } }).structuredContent?.total);
const catalog = await rpc("resources/read", { uri: "skills://catalog" });
console.log("catalog:", ((catalog as { contents?: { text: string }[] }).contents ?? []).length > 0 ? "ok" : "missing");
ctx.telemetry.close();
console.log("PROBE OK");
