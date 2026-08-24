---
name: csv-stats
description: 对表格数据做基础统计：行数、列名、数值列均值。依赖 csv-parse 提供表格输入。
license: MIT
---

# csv-stats

表格数据基础统计。

## 输入
- csv（可选）: CSV 字符串
- headers / rows（可选）: 已解析表格

## 输出
- count: 行数
- columns: 列名
- means: 数值列均值

## 依赖
依赖 data/csv-parse ^1.0.0；在 workflow 中通常作为 csv-parse 的下游。
