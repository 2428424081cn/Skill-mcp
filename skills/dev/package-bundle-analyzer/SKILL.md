---
name: package-bundle-analyzer
description: 前端打包体积分析与瘦身指南。提供重型依赖轻量替代方案（moment -> dayjs）与按需引入。
---

# 前端打包体积分析与瘦身指南

## 常见重型依赖替代清单
- `moment.js` (~300KB) -> **`dayjs`** (2KB) 或 **`date-fns`**
- `lodash` (全量导入) -> **`lodash-es`** 按需导入或原生 JS 方法
- `axios` -> 原生 **`fetch`**
