---
name: db-schema-inspector
description: 数据库结构探查与自省工具。探查 SQLite 数据库表清单、列类型、主键与记录行数。
---

# 数据库结构自省指南 (DB Schema Inspector)

在对 SQLite 数据库进行 SQL 编写或数据分析前，先提取其表结构与列元数据。

## 使用流程
```bash
node scripts/inspect_sqlite.mjs "data/telemetry.db"
```
