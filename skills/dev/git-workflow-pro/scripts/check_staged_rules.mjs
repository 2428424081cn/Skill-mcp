import { execSync } from "node:child_process";

const PATTERNS = [
  { regex: /console\.log\(/, desc: "JavaScript console.log 调试语句" },
  { regex: /debugger;/, desc: "JavaScript debugger 断点" },
  { regex: /TODO:\s*remove/i, desc: "未清理的临时 TODO 标记" }
];

try {
  const diff = execSync("git diff --cached", { encoding: "utf8" });
  const findings = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const p of PATTERNS) {
        if (p.regex.test(line)) findings.push(p.desc + " -> " + line.trim());
      }
    }
  }
  console.log("=== 暂存区合规扫描 ===");
  if (findings.length === 0) {
    console.log("✅ 暂存区检查通过，未发现遗留调试代码。");
  } else {
    console.log("⚠️ 发现潜在问题 (" + findings.length + " 处):");
    findings.forEach(f => console.log(" - " + f));
  }
} catch (e) {
  console.error("检查失败:", e.message);
}
