---
name: fetch-page
description: 抓取网页并提取标题与正文长度，需要网络权限（默认策略为拒绝，须授权）。
license: MIT
---

# fetch-page

抓取网页基本信息。

## 输入
- url: 目标地址

## 权限
需要 network 权限；默认策略拒绝，须经 skill_run 两段式授权。

## 输出
- ok / status / title / length
