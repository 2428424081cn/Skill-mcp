---
name: log-troubleshooter
description: 生产日志分析与异常聚类排查。提取日志中的 ERROR/WARN 报错行、聚合相似堆栈并输出频率分布。
---

# 生产日志智能分析指南 (Log Troubleshooter)

排查大型日志文件（几万行文本）中的致命错误原因与高频异常分布。

## 执行分析
```bash
node scripts/analyze_logs.mjs <日志文件路径>
```
