import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RULES = [
  { pat: /SELECT\s+.*\s+FROM\s+.*\+/i, desc: "高危：动态字符串拼接 SQL，可能存在 SQL 注入隐患" },
  { pat: /catch\s*\([a-zA-Z0-9_]*\)\s*\{\s*\}/, desc: "异常吞没：空 catch 块未记录日志或处理错误" },
  { pat: /setInterval\([^,]+,\s*[0-9]+\)/, desc: "定时器未显式销毁管理，注意内存泄漏" },
  { pat: /password\s*[:=]\s*["'][^"']+["']/i, desc: "疑似硬编码密码凭据" }
];

function scanFile(p) {
  const findings = [];
  try {
    const text = readFileSync(p, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((l, idx) => {
      for (const r of RULES) {
        if (r.pat.test(l)) {
          findings.push({ line: idx + 1, desc: r.desc, snippet: l.trim() });
        }
      }
    });
  } catch {}
  return findings;
}

function walk(dir) {
  let res = [];
  try {
    const stat = statSync(dir);
    if (stat.isFile()) return [{ file: dir, issues: scanFile(dir) }];
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".git") continue;
      const full = join(dir, item);
      if (statSync(full).isDirectory()) res = res.concat(walk(full));
      else if (/\.(ts|js|py|go|java)$/i.test(full)) {
        const issues = scanFile(full);
        if (issues.length) res.push({ file: full, issues });
      }
    }
  } catch {}
  return res;
}

const target = process.argv[2] || ".";
const results = walk(target);
console.log("=== 静态代码审查报告 (" + target + ") ===");
let total = 0;
results.forEach(r => {
  r.issues.forEach(i => {
    total++;
    console.log(`[${r.file}:${i.line}] ${i.desc}\n    代码: ${i.snippet}`);
  });
});
if (total === 0) console.log("✅ 未发现高危反模式与静态代码漏洞。");
