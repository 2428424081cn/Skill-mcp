---
name: organize-files
description: 按扩展名把目录里的文件整理进子目录（演示写权限隔离：mutating 操作默认须授权）。
license: MIT
---

# organize-files

按扩展名整理文件（权限隔离演示）。

## 输入
- directory / pattern

## 权限
声明 fsWrite + mutating=true；默认策略 ask —— 未授权时返回 dry-run 计划，不产生副作用。
