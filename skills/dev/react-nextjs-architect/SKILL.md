---
name: react-nextjs-architect
description: React 19 / Next.js App Router 现代前端架构规范。指导 Server/Client Components 边界划分、流式渲染（Streaming）与数据获取。
---

# Next.js & React 现代架构指南 (React Next.js Architect)

在设计或编写 Next.js (App Router) / React 19 应用时，遵循以下架构准则。

## 核心架构原则

1. **服务端优先（Server Components by Default）**：
   - 默认所有组件均为 Server Components（无需导入到客户端 JS Bundle）。
   - 仅在需要 `useState`、`useEffect`、`onClick` 等交互时在最顶层添加 `'use client'`。

2. **数据获取与缓存**：
   - 在 Server Component 中直接进行 `async/await` 异步数据请求，避免在客户端 `useEffect` 瀑布流拉取。

## 自动化检查脚本
```bash
node scripts/audit_nextjs_components.mjs <项目源码目录>
```
