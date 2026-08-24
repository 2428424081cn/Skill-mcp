---
name: code-review-guard
description: 静态代码审查与漏洞检查助手。深度扫描源码中的 SQL 拼接、空异常捕获、未清理定时器与硬编码凭据。
---

# 代码质量与静态审查指南 (Code Review Guard)

在协助用户评审代码、审查重构方案或合并分支前，执行本工作流。

## 审查流程
执行本地自动化代码扫描：
```bash
node scripts/scan_code_issues.mjs <目标文件或目录路径>
```
