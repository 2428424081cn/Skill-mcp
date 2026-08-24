---
name: systemd-service-manager
description: Linux Systemd 服务守护配置生成指南。配置自动重启策略、日志记录与非 root 安全运行。
---

# Linux Systemd 服务配置指南

## 生产级关键配置
- `Restart=always`：异常退出 5 秒后自动拉起。
- `User=www-data`：非 root 权限运行，降低提权安全风险。
