---
name: ci-cd-github-actions
description: GitHub Actions 流水线生成与优化指南。提供 pnpm/npm/pip 缓存加速策略与矩阵构建。
---

# GitHub Actions 高性能 CI/CD 指南

## 核心优化策略
1. **依赖缓存（Actions Cache）**：使用 `actions/setup-node` 的 `cache: 'pnpm'` 缩减 70% 安装时间。
2. **并发取消（Concurrency）**：对相同 PR 的连续 Push 自动取消旧构建，节约 Action 分钟数。
