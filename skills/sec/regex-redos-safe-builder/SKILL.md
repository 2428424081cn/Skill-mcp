---
name: regex-redos-safe-builder
description: 安全正则表达式构建指南：识别并杜绝 ReDoS 灾难性回溯漏洞与高耗时匹配反模式。
---

# 安全正则表达式 (ReDoS 防御) 构建规范

## 1. 致命的灾难性回溯模式 (Catastrophic Backtracking)

### ❌ 严禁使用的危险模式：
- **嵌套量词 (Nested Quantifiers)**：`/([a-zA-Z0-9]+)+$/` 或 `/(a+)*$/` （面对 `aaaaaaaaaaaaaaaa! ` 会导致 $O(2^n)$ 指数级计算锁死 CPU！）
- **重叠分支重复**：`/([a-z]+|[a-z0-9]+)+$/`

### ✅ 安全重构法则：
- 消除重叠区间：`/^[a-zA-Z0-9]+$/`
- 对长度设置硬上限限制，避免无限量词：`/^[a-zA-Z0-9]{1,128}$/`

## 2. 运行时防御铁律
1. **输入长度前置截断**：在执行正则匹配前，先断言输入长度：
   ```ts
   if (input.length > 1024) return false;
   ```
2. **使用线性时间引擎**：在高性能网关中优先使用不支持回溯的引擎（如 Google RE2）。
