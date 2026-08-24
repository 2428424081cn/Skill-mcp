import { readFileSync, basename } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.log("用法: node scripts/format_to_markdown.mjs <filepath>");
  process.exit(0);
}

try {
  const raw = readFileSync(file, "utf8");
  console.log(`# 文档内容摘要 (${basename(file)})\n`);
  console.log(raw.slice(0, 2000));
  if (raw.length > 2000) console.log(`\n... (已截断，共 ${raw.length} 字符)`);
} catch (e) {
  console.error("读取失败:", e.message);
}
