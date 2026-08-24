---
name: nestjs-prisma-drizzle
description: NestJS 模块化依赖注入架构与 Prisma / Drizzle ORM 端到端类型安全后端规范。
---

# NestJS 与类型安全 ORM (Prisma / Drizzle) 架构规范

## 1. 模块边界与依赖注入
- 每个业务功能必须是一个自包含的 `FeatureModule`（包含 Controller, Service, DTO, Repository）。
- 跨模块共享必须通过 `exports: [FeatureService]` 显式导出。

## 2. 全局参数校验与 DTO
- 开启全局 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`。
- 所有入参必须显式声明 DTO 并使用 `class-validator` 装饰器校验：

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail({}, { message: '请输入合法的邮箱地址' })
  email: string;

  @IsString()
  @MinLength(8, { message: '密码长度不得小于 8 位' })
  password: string;
}
```

## 3. ORM 事务与原子性
- 必须使用交互式事务保证多表操作原子性：
```ts
await this.prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: orderData });
  await tx.inventory.decrement({ where: { id: productId }, by: quantity });
  return order;
});
```
