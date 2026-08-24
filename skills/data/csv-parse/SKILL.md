---
name: csv-parse
description: 把 CSV 文本解析成结构化表格（headers + rows），支持引号转义。
license: MIT
---

# csv-parse

把 CSV 文本解析成结构化表格。

## 输入
- csv: CSV 字符串

## 输出
- headers: 表头数组
- rows: 数据行二维数组
- count: 数据行数

支持引号转义与逗号分隔。是 csv-stats 的上游。
