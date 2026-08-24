import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BAD_BOOLEAN_PATTERNS = [
  { regex: /\b(let|const|var)\s+(flag|status|check|valid|open|show)\s*[:=]\s*(true|false)/i, desc: "布尔变量缺少 is/has/should/can 谓词前缀" }
];

const BAD_ABBREVIATION_PATTERNS = [
  { regex: /\b(let|const|var)\s+(usr|mgr|tmp|btn_clk|chk|res_data)\b/i, desc: "使用了不规范的随意缩写（建议全拼）" },
  { regex: /\b(let|const|var)\s+[a-hj-z]\s*=/i, desc: "使用了无语义的单字母变量名（非循环计数器）" }
];

function scanFile(filepath) {
  const issues = [];
  try {
    const lines = readFileSync(filepath, "utf8").split(/\r?\n/);
    lines.forEach((l, idx) => {
      BAD_BOOLEAN_PATTERNS.forEach(p => {
        if (p.regex.test(l)) issues.push({ line: idx + 1, desc: p.desc, snippet: l.trim() });
      });
      BAD_ABBREVIATION_PATTERNS.forEach(p => {
        if (p.regex.test(l)) issues.push({ line: idx + 1, desc: p.desc, snippet: l.trim() });
      });
    });
  } catch {}
  return issues;
}

function walk(dir) {
  let res = [];
  try {
    const s = statSync(dir);
    if (s.isFile()) return [{ file: dir, issues: scanFile(dir) }];
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".git") continue;
      const full = join(dir, item);
      if (statSync(full).isDirectory()) res = res.concat(walk(full));
      else if (/\.(ts|js|py|go)$/i.test(full)) {
        const issues = scanFile(full);
        if (issues.length) res.push({ file: full, issues });
      }
    }
  } catch {}
  return res;
}

const target = process.argv[2] || ".";
const findings = walk(target);
console.log("=== 🔍 变量与代码命名规范审计 (" + target + ") ===");
let total = 0;
findings.forEach(f => {
  f.issues.forEach(i => {
    total++;
    console.log(`[${f.file}:${i.line}] ${i.desc}\n    代码: ${i.snippet}`);
  });
});
if (total === 0) console.log("✅ 变量命名完美符合 Clean Code 规范！");
