import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  let clientComponents = [];
  let serverComponents = [];
  try {
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".next" || item === ".git") continue;
      const p = join(dir, item);
      if (statSync(p).isDirectory()) {
        const sub = walk(p);
        clientComponents = clientComponents.concat(sub.client);
        serverComponents = serverComponents.concat(sub.server);
      } else if (/\.(tsx|jsx)$/i.test(p)) {
        const content = readFileSync(p, "utf8");
        if (/^\s*['"]use client['"]/m.test(content)) clientComponents.push(p);
        else serverComponents.push(p);
      }
    }
  } catch {}
  return { client: clientComponents, server: serverComponents };
}

const dir = process.argv[2] || "src";
console.log("=== Next.js 组件架构扫描 (" + dir + ") ===");
const res = walk(dir);
console.log(`✅ Server Components (零打包体积): ${res.server.length} 个`);
console.log(`⚡ Client Components ('use client'): ${res.client.length} 个`);
if (res.client.length > res.server.length) {
  console.log("⚠️ 建议：客户端组件占比过高，可尝试将静态展示部分下沉为 Server Components。");
}
