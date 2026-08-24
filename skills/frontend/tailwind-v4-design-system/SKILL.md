---
name: tailwind-v4-design-system
description: TailwindCSS v4 现代化 CSS 变量架构、@theme 指令与容器查询 (Container Queries) 设计准则。
---

# TailwindCSS v4 设计系统与现代 CSS 规范

## 1. Tailwind v4 核心架构变更
- **移除 `tailwind.config.js`**：Tailwind v4 完全转向纯 CSS 原生配置。
- **`@theme` 指令**：所有主题变量直接定义在 `app.css` 的 `@theme` 块内。
- **OKLCH 色彩空间**：全面推荐使用 OKLCH 色彩空间，具备更自然的人眼感知均匀性。

```css
@import "tailwindcss";

@theme {
  --color-primary-50: oklch(0.97 0.02 260);
  --color-primary-500: oklch(0.55 0.22 260);
  --color-primary-900: oklch(0.25 0.15 260);

  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "JetBrains Mono", monospace;

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}
```

## 2. 容器查询 (Container Queries)
现代响应式组件不应仅依赖屏幕宽度（Viewport），而应依赖自身父容器尺寸：
```html
<div class="@container">
  <div class="flex flex-col @sm:flex-row @lg:grid @lg:grid-cols-3">
    <!-- 当父容器宽度 > 400px 时横排，> 768px 时网格 -->
  </div>
</div>
```
