---
name: architecture-decision-records
description: 架构决策记录 (ADR) 标准规范：技术选型、架构权衡论证与变更生命周期管理。
---

# 架构决策记录 (ADR) 标准模板

每个重大技术决策必须以 Markdown 形式归档在 `docs/adr/ADR-XXXX-标题.md` 中。

## ADR 结构规范

```markdown
# ADR-0001: 采用 TanStack Query 替代 Redux 管理服务端状态

- **状态 (Status)**: [提议中 / 已采纳 / 已废弃 / 已被取代]
- **日期 (Date)**: 2026-08-24
- **决策者 (Deciders)**: 前端架构组

## 1. 背景与问题描述 (Context)
当前应用中大量使用 Redux Toolkit 手动维护 Loading、Error 以及缓存失效逻辑，导致 Boilerplate 冗长，频繁出现多组件间数据状态不一致的问题。

## 2. 决策驱动因素 (Decision Drivers)
- 减少 50% 以上的手动异步状态模板代码
- 原生支持 SWR（Stale-While-Revalidate）与自动轮询缓存
- 具备完善的 DevTools 与乐观更新支持

## 3. 备选方案对比 (Considered Options)
1. **方案 A: TanStack Query (React Query)**：专注于服务端异步状态，极简 Hook，零样板代码。
2. **方案 B: RTK Query**：集成在 Redux Toolkit 内，但配置复杂，学习成本较高。
3. **方案 C: SWR**：轻量但对复杂突变与乐观更新支持不如 TanStack Query 完备。

## 4. 最终决策结果 (Decision Outcome)
采纳 **方案 A (TanStack Query)**。

### 影响与正面后果 (Positive Consequences)
- 服务端数据拉取代码量减少 60%
- 自动处理组件卸载后的缓存清理

### 负面影响与应对措施 (Negative Consequences)
- 客户端纯 UI 状态（如弹窗开关、折叠面板）仍需保留轻量 Zustand 管理。
```
