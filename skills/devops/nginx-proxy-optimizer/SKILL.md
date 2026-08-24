---
name: nginx-proxy-optimizer
description: Nginx 反向代理与性能调优指南。提供 Gzip 静态压缩、HSTS 增强与 upstream 负载均衡模板。
---

# Nginx 高性能反向代理配置指南

## 生产级关键配置
- **启用 Gzip 压缩**：压缩 `text/plain`、`application/json`、`text/css`，降低带宽 70%。
- **Websocket 支持**：配置 `proxy_set_header Upgrade $http_upgrade`。
