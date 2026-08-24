---
name: decision-tradeoff-matrix
description: 多准则决策权衡与加权打分矩阵。拒绝凭直觉做选型，用量化指标权衡性能、研发成本与不可逆风险。
---

# 架构决策权衡矩阵指南 (Decision Trade-off Matrix)

做技术选型时，**没有完美的架构，只有适合特定场景的权衡（Trade-off）**。

## 经典 5 维加权打分法
1. **性能与吞吐（Performance, 权重 25%）**：延迟、QPS、资源消耗。
2. **开发效率与生态（DX & Ecosystem, 权重 25%）**：学习成本、社区成熟度、库丰富度。
3. **运维与可观测性（Ops & Reliability, 权重 20%）**：高可用搭建难度、监控指标支持。
4. **财务成本（Financial Cost, 权重 15%）**：服务器硬件开销、SaaS 授权费用。
5. **决策可逆性（Reversibility, 权重 15%）**：如果做错了，迁移到其他方案的重构代价。
