import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PATTERNS = [
  { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{32,}/g },
  { name: "Google API Key", regex: /AIzaSy[0-9A-Za-z-_]{33}/g },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub Token", regex: /ghp_[a-zA-Z0-9]{36}/g },
  { name: "Private Key", regex: /-----BEGIN [A-Z\s]+ PRIVATE KEY-----/g }
];

function scan(dir) {
  let findings = [];
  try {
    const s = statSync(dir);
    if (s.isFile()) {
      const text = readFileSync(dir, "utf8");
      PATTERNS.forEach(p => {
        const matches = text.match(p.regex);
        if (matches) {
          matches.forEach(m => {
            const masked = m.slice(0, 4) + "***" + m.slice(-4);
            findings.push({ file: dir, type: p.name, sample: masked });
          });
        }
      });
      return findings;
    }
    for (const item of readdirSync(dir)) {
      if (item === "node_modules" || item === ".git") continue;
      findings = findings.concat(scan(join(dir, item)));
    }
  } catch {}
  return findings;
}

const target = process.argv[2] || ".";
const res = scan(target);
console.log("=== 敏感凭据安全扫描 (" + target + ") ===");
if (res.length === 0) {
  console.log("✅ 未发现明文敏感 API Key 或私钥泄露。");
} else {
  console.log(`🚨 警告：发现 ${res.length} 处疑似敏感泄露:`);
  res.forEach(r => console.log(` - [${r.file}] 类型: ${r.type} (${r.sample})`));
}
