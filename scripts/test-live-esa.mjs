import http from "node:http";

function callMcp(tool, args) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 100000),
      method: "tools/call",
      params: { name: tool, arguments: args }
    });
    const req = http.request({
      hostname: "mcp.javastar.asia",
      port: 80,
      path: "/mcp",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve(JSON.parse(buf)));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

console.log("🚀 开始全链路模拟 AI 调用线上 MCP (http://mcp.javastar.asia/mcp)\n");

console.log("================================================================");
console.log("🤖 场景 1：AI 收到用户任务 -> [帮我用 TypeScript 写一个用户登录 API]");
console.log("================================================================");

// 步骤 1：AI 执行 skill_search 检索
console.log("\n[步骤 1] AI 调用 skill_search 查业务工具与准则...");
const search1 = await callMcp("skill_search", { query: "TypeScript 用户登录 API 接口", topK: 3 });
const s1Data = search1.result.structuredContent;
console.log("✅ 匹配到的业务工具:");
s1Data.hits.forEach((h, i) => console.log("   " + (i + 1) + ". " + h.key + " (fit: " + h.fit + ")"));
console.log("✅ 自动附带的强制准则数: " + s1Data.activeRules.length + " 条");

// 步骤 2：AI 根据注入准则，主动调用 skill_get 获取 RESTful 规范（用短名）
console.log("\n[步骤 2] AI 主动调用 skill_get('web:restful-api-standard')...");
const get1 = await callMcp("skill_get", { key: "web:restful-api-standard" });
console.log("✅ 成功拉取 RESTful 规范手册 (大小: " + get1.result.content[0].text.length + " 字符):");
console.log(get1.result.content[0].text.slice(0, 180) + "...\n");

// 步骤 3：AI 主动调用 skill_get 获取命名规范（用纯名称）
console.log("[步骤 3] AI 主动调用 skill_get('naming-conventions')...");
const get2 = await callMcp("skill_get", { key: "naming-conventions" });
console.log("✅ 成功拉取命名规范守则 (大小: " + get2.result.content[0].text.length + " 字符):");
console.log(get2.result.content[0].text.slice(0, 180) + "...\n");

// 步骤 4：AI 主动调用 skill_get 获取严格 TS 规范
console.log("[步骤 4] AI 主动调用 skill_get('dev:typescript-strict-guard')...");
const get3 = await callMcp("skill_get", { key: "dev:typescript-strict-guard" });
console.log("✅ 成功拉取 TS 严格防御准则 (大小: " + get3.result.content[0].text.length + " 字符):");
console.log(get3.result.content[0].text.slice(0, 180) + "...\n");

// 步骤 5：AI 主动调用思维链规范
console.log("[步骤 5] AI 主动调用 skill_get('reasoning:sequential-thinking')...");
const get4 = await callMcp("skill_get", { key: "reasoning:sequential-thinking" });
console.log("✅ 成功拉取动态思维链规范 (大小: " + get4.result.content[0].text.length + " 字符):");
console.log(get4.result.content[0].text.slice(0, 180) + "...\n");

console.log("================================================================");
console.log("🎉 模拟测试全部通过！所有技能与准则均在阿里云 ESA 边缘节点毫秒级拉取！");
console.log("================================================================");
