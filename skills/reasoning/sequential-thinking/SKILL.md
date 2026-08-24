---
name: sequential-thinking
description: 动态思维链与假设回溯工具。强制 AI 在输出结论前分步骤深度推导、校验假设并支持自省回溯。
---

# 动态思维链与回溯推导指南 (Sequential Thinking)

当你面对复杂、模糊、分支众多或逻辑极度严密的挑战时，**禁止立刻给出最终代码或草率结论**，必须调用本技能进行结构化分步推演。

## 思考执行法则

1. **初始假设（Hypothesis Formulation）**：
   - 步骤 1：明确核心问题、已知边界条件与待验证的前提假设。
2. **渐进推导（Step-by-Step Deduction）**：
   - 步骤 2+：每一步只推导一个局部子问题，并评估中间推导的可靠度。
3. **主动自省与回溯（Revision & Backtracking）**：
   - 如果发现当前推导与前序条件矛盾，**立即设置 `isRevision: true`，回溯到矛盾发生的节点，开辟新分支 `branchId: "branch-b"`**。
4. **收敛与最终综合（Convergence）**：
   - 当所有逻辑漏洞闭环且无未解决反例后，将 `needsMoreThoughts` 设为 `false`，输出最终严密方案。

## 辅助脚本调用
```bash
node scripts/sequential_tracker.mjs --step 1 --total 4 --thought "假设系统瓶颈在连接池而非 CPU..."
```
