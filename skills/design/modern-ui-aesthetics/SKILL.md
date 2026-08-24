---
name: modern-ui-aesthetics
namespace: design
version: 1.0.0
skillType: rule
description: 现代 Web 美学与交互设计准则
---

# 现代 Web 美学与交互设计准则

在生成任何前端界面、Web 应用或 CSS 样式时，AI 必须拒绝平庸与廉价感，遵循顶级设计规范。

## 一、 色彩与 Design Tokens
1. **严禁硬编码随意颜色**：绝不允许在组件内随意手写 `#ff0000`、`#3b82f6`。必须使用 CSS 变量或语义化 Token（如 `--color-primary`, `--color-surface-elevated`）。
2. **Dark Mode 原生支持**：使用 HSL 色彩空间构建色彩梯度，确保亮色/暗色模式对比度达到 WCAG 2.1 AA 级（文本对比度 >= 4.5:1）。
3. **层次与玻璃拟态 (Glassmorphism)**：巧妙结合 `backdrop-filter: blur()` 与半透明边框，营造精致空间深度。

## 二、 8pt 网格与排版层级
1. **间距阶梯**：所有 `margin`、`padding`、`gap` 必须基于 4px / 8px 的倍数阶梯（4, 8, 12, 16, 24, 32, 48, 64px）。
2. **现代无衬线字体**：优先采用 Inter, Roboto, Plus Jakarta Sans, Outfit 或系统原生字体栈，禁止使用浏览器粗糙默认字体。

## 三、 微交互与动态响应 (Micro-Interactions)
1. **一切可交互元素必须有状态响应**：`hover`、`focus-visible`、`active`、`disabled` 状态必须具备平滑过渡动画（150ms ~ 250ms `cubic-bezier(0.4, 0, 0.2, 1)`）。
2. **触觉反馈与防抖动**：按钮点击时可配合微小缩放（`transform: scale(0.98)`），禁止在 hover 时触发因边框增厚导致的页面布局抖动（Layout Shift）。
