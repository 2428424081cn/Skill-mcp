---
name: typescript-strict-guard
namespace: dev
version: 1.0.0
skillType: rule
description: TypeScript 严格类型防御准则
---

# TypeScript 严格类型防御准则

在生成任何 TypeScript 代码时，AI 必须严格执行零妥协（Zero-Tolerance）类型安全规则。

## 一、 铁律（Zero Tolerance）
1. **严禁 `any`**：绝对禁止直接或间接使用 `any`。未知数据必须使用 `unknown` 并通过 Type Guard / Zod 校验收窄。
2. **严禁不安全断言**：禁止使用 `as unknown as T` 或随意使用非空断言 `!`（除非能严格证明其前置不变式）。
3. **强制导出显式返回类型**：所有导出的函数、类方法必须显式标注返回类型，严禁依赖隐式推导。
4. **不可变数据优先**：对象数组参数优先标注 `readonly T[]` 或 `Readonly<T>`，禁止在函数内直接 mutate 入参。

## 二、 核心设计模式要求
- **Discriminated Unions（可辨识联合）**：状态模型必须通过唯一的 `kind` / `status` / `type` 字段进行状态分支隔离。
- **`satisfies` 优于类型标注**：在需要保留字面量类型且满足契约时，优先使用 `satisfies` 操作符。

## 三、 范例对比
- ❌ **反例**:
```typescript
function handleData(data: any) {
  return (data as any).user.name!;
}
```
- ✅ **正例**:
```typescript
interface UserData {
  user: { name: string };
}
function isUserData(obj: unknown): obj is UserData {
  return typeof obj === "object" && obj !== null && "user" in obj;
}
export function handleData(raw: unknown): string {
  if (!isUserData(raw)) throw new Error("Invalid payload");
  return raw.user.name;
}
```
