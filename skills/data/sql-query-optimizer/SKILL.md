---
name: sql-query-optimizer
description: SQL 性能优化与慢查询诊断。提供索引覆盖（Covering Index）、分页深度优化与 JOIN 性能建议。
---

# SQL 性能优化与索引调优指南

## 常见慢查询反模式与优化方案
1. **避免 `SELECT *`**：仅投影业务所需列，利于覆盖索引（Covering Index）。
2. **大偏移量深度分页优化**：使用延迟关联或游标式分页代替 `LIMIT 1000000, 20`。
3. **模糊搜索前缀匹配**：`LIKE '%abc'` 无法走索引，建议全文索引或前缀索引。
