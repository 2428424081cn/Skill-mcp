---
name: prompt-ab-testing
description: 大模型 Prompt 提示词 A/B 测试与版本迭代指南。提供提示词量化评估指标与防御性提示词设计。
---

# Prompt 提示词 A/B 迭代与评估指南

## 核心设计法则
1. **正向引导优于纯负向约束**：使用 *“请输出 JSON 格式”* 代替 *“不要输出任何说明文字”*。
2. **结构化标记划分（Delimiters）**：使用 `### 指令`、`<context>` 明确区分任务与数据输入，防止提示词注入（Prompt Injection）。
