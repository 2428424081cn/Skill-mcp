// 测试准则型 Skill (skillType: "rule") 自动注入机制
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";

const { server } = await createSkillMcp({
  skillsDir: join(process.cwd(), "skills"),
  dataDir: join(process.cwd(), "data"),
});

await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });

async function search(query: string) {
  const res = await server.handle({
    jsonrpc: "2.0", id: Math.floor(Math.random() * 100000),
    method: "tools/call",
    params: { name: "skill_search", arguments: { query, topK: 3 } },
  });
  const r = res as any;
  // content[0].text 包含完整的 JSON 字符串
  return JSON.parse(r.result.content[0].text);
}

const queries = [
  "帮我写一个用户登录的 API 接口",
  "分析一下这个日志为什么报错",
  "把 CSV 数据生成一份报表",
];

for (const q of queries) {
  console.log("=".repeat(60));
  console.log("USER: " + q);
  console.log("=".repeat(60));

  const data = await search(q);

  console.log("\n[Tool Skills - on-demand matches]:");
  (data.hits as any[]).slice(0, 3).forEach((h: any, i: number) => {
    console.log("  " + (i + 1) + ". " + h.key + " (fit: " + h.fit + ")");
  });

  const rules = data.activeRules;
  if (rules && rules.length > 0) {
    console.log("\n[Rule Skills - ALWAYS injected (" + rules.length + " rules)]:");
    (rules as any[]).forEach((r: any, i: number) => {
      console.log("  " + (i + 1) + ". [RULE] " + r.key);
      console.log("         " + (r.description || "").slice(0, 60) + "...");
    });
    console.log("\n[System Note]: " + data.activeRulesNote);
  } else {
    // Debug：输出所有返回的 key 以排查
    console.log("\nDEBUG: All keys in response:", Object.keys(data));
  }
  console.log("");
}

console.log("RULE INJECTION TEST COMPLETE");
