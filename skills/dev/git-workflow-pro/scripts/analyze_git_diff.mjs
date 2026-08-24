import { execSync } from "node:child_process";

try {
  const status = execSync("git status --porcelain", { encoding: "utf8" });
  const diffStat = execSync("git diff --stat", { encoding: "utf8" });
  const stagedStat = execSync("git diff --cached --stat", { encoding: "utf8" });
  console.log("=== Git 变更分析摘要 ===");
  console.log("【文件状态】:\n" + (status.trim() || "(工作区干净)"));
  console.log("\n【未暂存统计】:\n" + (diffStat.trim() || "(无)"));
  console.log("\n【已暂存统计】:\n" + (stagedStat.trim() || "(无)"));
} catch (e) {
  console.error("Git 分析失败:", e.message);
}
