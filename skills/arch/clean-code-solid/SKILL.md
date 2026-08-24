---
name: clean-code-solid
namespace: arch
version: 1.0.0
skillType: rule
description: Clean Code & SOLID 架构设计准则
---

# Clean Code & SOLID 架构设计准则

在生成任何工程级模块、类与函数时，AI 必须严格执行以下设计准则。

## 一、 SOLID 五大原则落实
1. **Single Responsibility (单一职责)**：一个函数/类只做一件事，只有一个发生变动的理由。单个函数长度控制在 30 行以内。
2. **Open/Closed (开闭原则)**：对扩展开放，对修改关闭。通过策略模式（Strategy）或多态接口扩展新功能，禁止在业务函数内堆砌巨大的 `switch-case` / `if-else`。
3. **Liskov Substitution (里氏替换)**：子类必须可以无缝替换基类而不破坏程序正确性，严禁子类抛出 `NotImplementedException`。
4. **Interface Segregation (接口隔离)**：胖接口拆分为瘦接口。客户端不应该被迫依赖它用不到的方法。
5. **Dependency Inversion (依赖倒置)**：高层业务模块不依赖底层实现（如具体数据库、第三方 SDK），二者均依赖抽象接口。

## 二、 认知复杂度 (Cognitive Complexity) 控制
- 严禁超过 3 层以上的条件嵌套。
- 采用 **Early Return（卫语句优先）** 模式，前置抛出异常或返回，保持主干逻辑平铺。
- 禁止魔法数字（Magic Numbers），常量必须具备语义化命名。
