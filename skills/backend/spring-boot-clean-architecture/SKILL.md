---
name: spring-boot-clean-architecture
description: Spring Boot 3 / Java 企业级 DDD 领域驱动设计与六边形 (Hexagonal) 干净架构规范。
---

# Spring Boot 3 DDD 与六边形干净架构规范

## 1. 严格四层依赖单向原则 (Dependency Rule)

```text
Presentation (Controller / REST API)
   ↓ 依赖
Application (Use Cases / Application Services / DTOs)
   ↓ 依赖
Domain (Entities / Value Objects / Domain Events / Ports)  ← 核心：零框架依赖！
   ↑ 被实现
Infrastructure (JPA / MyBatis / Redis / Kafka / Feign Adapters)
```

**铁律**：`Domain` 核心层绝不允许引入 Spring / JPA / MyBatis 相关的任何注解与框架依赖，保持纯 POJO。

## 2. 领域实体与值对象规范
- **Entity**：具有唯一标识（ID）和业务生命周期变化。
- **Value Object**：不可变（Immutable），使用 Java 17+ `record` 编写（如 `Money`, `EmailAddress`）：

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount, "Amount cannot be null");
        Objects.requireNonNull(currency, "Currency cannot be null");
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("Amount cannot be negative");
        }
    }
    public Money add(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new IllegalArgumentException("Currency mismatch");
        }
        return new Money(this.amount.add(other.amount), this.currency);
    }
}
```

## 3. 防腐层与 DTO 转换
- 严禁将数据库实体（JPA Entity）直接返回给前端或跨微服务暴露。
- 必须使用 MapStruct 等工具在 Controller 层将 DTO 与 Domain Model 进行严格解耦转换。
