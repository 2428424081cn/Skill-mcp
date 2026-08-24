---
name: e2e-playwright-tester
description: Playwright 端到端自动化测试生成指南。遵循 Page Object Model (POM) 架构与弹性 Locator 定位。
---

# Playwright Web E2E 自动化测试指南

## 核心准则
1. **优先使用用户可见属性定位**：如 `page.getByRole('button', { name: 'Submit' })` 或 `page.getByLabel('Username')`，避免脆弱的深层 XPath。
2. **自动等待（Auto-waiting）**：Playwright 自带元素可见性与可交互性等待，无需显式 `sleep`。
