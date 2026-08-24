---
name: vitest-pytest-unit-testing
description: 现代单元测试黄金法则：AAA 模式、表驱动参数化测试与精准 Mock 隔离规范。
---

# 现代单元测试黄金法则 (Vitest & Pytest)

## 1. AAA (Arrange-Act-Assert) 三段式结构
每一个单元测试必须结构分明，禁止将准备、执行和断言混在一起：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('OrderService.checkout', () => {
  it('should calculate discount and deduct inventory successfully', async () => {
    // 1. Arrange (准备测试上下文与依赖 Mock)
    const mockInventory = { deduct: vi.fn().mockResolvedValue(true) };
    const service = new OrderService(mockInventory);
    const order = { id: 'o-1', total: 100, couponCode: 'VIP10' };

    // 2. Act (执行待测方法)
    const result = await service.checkout(order);

    // 3. Assert (断言结果与副作用)
    expect(result.finalPrice).toBe(90);
    expect(mockInventory.deduct).toHaveBeenCalledWith('o-1');
  });
});
```

## 2. 表驱动参数化测试 (Table-Driven Testing)
对于多分支与边界值测试，必须采用表驱动方式，提升测试覆盖率与维护性：

```ts
it.each([
  { input: 'test@example.com', expected: true },
  { input: 'invalid-email', expected: false },
  { input: '@missing-local.com', expected: false },
  { input: 'spaces in@mail.com', expected: false },
])('validateEmail("$input") should return $expected', ({ input, expected }) => {
  expect(validateEmail(input)).toBe(expected);
});
```
