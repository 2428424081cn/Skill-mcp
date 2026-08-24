import { readFileSync } from "node:fs";

const logFile = process.argv[2];
if (!logFile) {
  console.log("用法: node scripts/analyze_logs.mjs <path/to/logfile.log>");
  process.exit(0);
}

try {
  const content = readFileSync(logFile, "utf8");
  const lines = content.split(/\r?\n/);
  const errorCounts = new Map();
  let totalErrors = 0;

  for (const l of lines) {
    if (/ERROR|FATAL|Exception|Unhandled/i.test(l)) {
      totalErrors++;
      const cleaned = l.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\s]*/, "")
                       .replace(/0x[0-9a-fA-F]+/g, "<HEX>")
                       .replace(/\d+/g, "<N>")
                       .trim().slice(0, 100);
      errorCounts.set(cleaned, (errorCounts.get(cleaned) || 0) + 1);
    }
  }

  console.log(`=== 日志异常排查报告 (${logFile}) ===`);
  console.log(`总日志行数: ${lines.length} | 发现异常错误: ${totalErrors} 处\n`);
  console.log("高频错误聚类排行 Top 10:");
  const sorted = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  sorted.forEach(([msg, count], idx) => {
    console.log(` [${idx + 1}] 频次: ${count}次\n     ${msg}`);
  });
} catch (e) {
  console.error("读取日志失败:", e.message);
}
