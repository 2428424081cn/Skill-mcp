---
name: summarize
description: 把长文本压缩成简短摘要，适合会议记录、文章、文档的快速概览。
license: MIT
---

# summarize

把长文本压缩成简短摘要。

## 输入
- text: 待总结文本
- maxLength: 摘要长度上限（默认 200）

## 说明
当前为启发式截断实现（v1 演示版）：清洗空白、按词边界截断。生产环境应替换为 LLM 摘要。
