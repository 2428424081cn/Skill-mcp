---
name: typescript-strict-migrator
description: TypeScript 严格模式迁移助手。指导 unknown/never 安全收窄、消除 any 与泛型优化。
---

# TypeScript 严格模式与类型安全指南

## 核心原则
- **优先使用 `unknown` 替代 `any`**：强制使用者先通过类型守卫（Type Guard）或 Zod 验证再访问属性。
- **避免非空断言（`!`）**：使用可选链（`?.`）或空值合并（`??`）进行安全防御。
