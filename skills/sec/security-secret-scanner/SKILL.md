---
name: security-secret-scanner
description: 敏感凭据与私钥泄露扫描器。深度扫描源码、配置文件与日志中的 API Key、AWS Token、私钥证书与密码。
---

# 敏感凭据防泄漏扫描指南 (Security Secret Scanner)

在代码对外公开、提交 Git 仓库或生成发布包前，执行本技能保障凭据安全。

## 扫描命令
```bash
node scripts/detect_secrets.mjs <目标路径>
```
