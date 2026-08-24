---
name: shadcn-ui-radix-architect
description: Shadcn UI 与 Radix UI 现代前端无障碍可复用组件架构规范与最佳实践指南。
---

# Shadcn UI 与 Radix UI 现代前端组件架构规范

本规范指导 AI 生成符合工业级标准、无障碍（WAI-ARIA）就绪且高度可定制的现代 React / Next.js UI 组件。

## 1. 核心设计原则

- **所有权属于用户 (Own your code)**：组件代码直接内嵌在项目中，而非从庞大的外部黑盒 npm 库中引入。
- **Radix UI 无状态原语 (Headless Primitives)**：负责核心状态机、键盘导航（Keyboard Navigation）、焦点捕获（Focus Trapping）与 ARIA 属性。
- **CVA (Class Variance Authority)**：严格使用 CVA 管理组件的多变体（variants）与尺寸（sizes）。
- **Tailwind Merge + Clsx**：所有类名拼接必须通过 `cn(...)` 工具函数进行合并，防止样式优先级冲突。

## 2. 标准组件实现模式 (以 Button 为例)

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
```

## 3. 强制准则

1. **必须支持 `asChild` 模式**：通过 `@radix-ui/react-slot` 让组件可渲染为 Link 或其他自定义元素。
2. **严禁硬编码颜色值**：严禁写死 `#1677ff` 或 `bg-blue-600`，必须使用 CSS 变量代号（如 `bg-primary`, `text-muted-foreground`）。
3. **微交互与无障碍**：必须包含 `focus-visible:ring` 焦点环与 `disabled:opacity-50` 禁用态。
