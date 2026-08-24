import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

function scan(dir) {
  let anyList = [];
  try {
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".git") continue;
      const p = join(dir, item);
      if (statSync(p).isDirectory()) anyList = anyList.concat(scan(p));
      else if (/\.(ts|tsx)$/i.test(p)) {
        const lines = readFileSync(p, "utf8").split(/\r?\n/);
        lines.forEach((l, idx) => {
          if (/:\s*any\b|<any>/i.test(l) && !/\/\//.test(l)) {
            anyList.push({ file: p, line: idx + 1, code: l.trim() });
          }
        });
      }
    }
  } catch {}
  return anyList;
}

const target = process.argv[2] || "src";
const res = scan(target);
console.log("=== TypeScript Any 类型扫描 (" + target + ") ===");
console.log(`发现 ${res.length} 处 'any' 类型使用:\n`);
res.slice(0, 15).forEach(r => console.log(`[${r.file}:${r.line}] ${r.code}`));
if (res.length > 15) console.log(`... 还有 ${res.length - 15} 处省略`);
