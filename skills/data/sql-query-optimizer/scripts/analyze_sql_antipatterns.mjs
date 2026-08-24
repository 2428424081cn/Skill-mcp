const sql = process.argv[2] || "SELECT * FROM orders WHERE name LIKE '%test%' ORDER BY id LIMIT 10000, 20";

console.log("=== SQL 静态性能诊断报告 ===");
console.log("查询语句: " + sql + "\n");

const warnings = [];
if (/SELECT\s+\*/i.test(sql)) warnings.push("【反模式】使用了 'SELECT *'，建议明确指定列名以触发覆盖索引。");
if (/LIKE\s+['"]%/i.test(sql)) warnings.push("【反模式】使用了左模糊匹配 'LIKE %...'，会导致 B+ 树索引失效全表扫描。");
if (/LIMIT\s+\d{4,}/i.test(sql)) warnings.push("【反模式】检测到大偏移量深度分页，建议采用 'WHERE id > last_id LIMIT N' 游标分页。");
if (/OR\s+/i.test(sql)) warnings.push("【建议】WHERE 条件中包含 OR，注意确认是否会导致联合索引失效（考虑 UNION ALL）。");

if (warnings.length === 0) {
  console.log("✅ 未检测到显式的 SQL 性能反模式。");
} else {
  warnings.forEach(w => console.log(w));
}
