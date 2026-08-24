import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VULN_PATTERNS = [
  { name: "DOM XSS (dangerouslySetInnerHTML)", regex: /dangerouslySetInnerHTML/i },
  { name: "危险代码执行 (eval / Function)", regex: /\beval\s*\(|new\s+Function\s*\(/ },
  { name: "CORS 通配符 (*)", regex: /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*['"]/i },
  { name: "不安全的 Cookie (缺少 HttpOnly/Secure)", regex: /document\.cookie\s*=/i }
];

function scan(dir) {
  let issues = [];
  try {
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".git") continue;
      const p = join(dir, item);
      if (statSync(p).isDirectory()) issues = issues.concat(scan(p));
      else if (/\.(js|ts|tsx|jsx|py|html)$/i.test(p)) {
        const text = readFileSync(p, "utf8");
        VULN_PATTERNS.forEach(v => {
          if (v.regex.test(text)) issues.push({ file: p, issue: v.name });
        });
      }
    }
  } catch {}
  return issues;
}

const target = process.argv[2] || "src";
const findings = scan(target);
console.log("=== OWASP Top 10 安全静态审计 (" + target + ") ===");
if (findings.length === 0) {
  console.log("✅ 未发现明显的 XSS / 危险执行与宽泛配置。");
} else {
  console.log(`⚠️ 发现 ${findings.length} 个潜在安全关注点:`);
  findings.forEach(f => console.log(` - [${f.file}] ${f.issue}`));
}
