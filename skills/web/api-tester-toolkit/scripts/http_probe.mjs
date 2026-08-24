const url = process.argv[2] || "https://api.github.com/zen";
const method = process.argv[3] || "GET";

console.log(`发起网络测试: [${method}] ${url} ...`);
const start = Date.now();
try {
  const res = await fetch(url, {
    method,
    headers: { "User-Agent": "Skill-MCP-Agent/1.0" }
  });
  const latency = Date.now() - start;
  const text = await res.text();
  console.log(`✅ 响应状态码: ${res.status} ${res.statusText}`);
  console.log(`⏱️ 网络耗时: ${latency} ms`);
  console.log("📦 响应内容摘要:\n" + text.slice(0, 500));
} catch (e) {
  console.error("❌ 请求失败:", e.message);
}
