---
name: api-tester-toolkit
description: API 接口网络测试与耗时诊断工具包。发起 HTTP GET/POST 请求、统计响应耗时与状态码、检查响应数据。
---

# API 接口网络测试指南 (API Tester Toolkit)

当需要对外部或本地 HTTP 接口进行连通性探测、健康检查与耗时测量时使用。

## 使用流程
```bash
node scripts/http_probe.mjs "https://api.github.com/zen"
```
