---
name: owasp-top10-auditor
description: OWASP Top 10 安全审计助手。静态检测 XSS、未过滤 eval、明文认证传输与 CORS 宽泛配置。
---

# OWASP Top 10 Web 安全排查指南

## 核心排查项目
1. **A01: 权限控制失效 (Broken Access Control)**：检查 URL 路由是否缺失 Auth Guard。
2. **A03: 注入风险 (Injection)**：检查 SQL/NoSQL/Command 拼接。
3. **A07: 身份识别与认证失败**：检查 Session 固定与弱密码策略。

## 执行扫描
```bash
node scripts/scan_owasp_vulns.mjs <源码目录>
```
