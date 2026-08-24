---
name: git-workflow-pro
description: Git 规范化工作流助手。自动分析暂存区/工作区代码变动，生成符合 Conventional Commits 规范的提交信息，提供分支管理与冲突排查流程。
---

# Git 规范化工作流指南 (Git Workflow Pro)

当需要提交代码、整理提交历史、检查未跟踪文件或排查冲突时，遵循本工作流。

## 核心工作流

### 第一步：分析代码变动
运行分析脚本提取工作区与暂存区的变动摘要：
```bash
node scripts/analyze_git_diff.mjs
```

### 第二步：生成规范提交信息 (Conventional Commits)
遵循如下提交格式：
```text
<type>(<scope>): <subject>

<body>

<footer>
```

#### Type 类型标准：
- `feat`: 新增功能
- `fix`: 修复缺陷
- `docs`: 文档变动
- `style`: 不影响代码逻辑的代码格式变动
- `refactor`: 重构代码（非新功能、非缺陷修复）
- `perf`: 性能优化
- `test`: 测试用例增改
- `chore`: 构建流程或辅助工具变动

### 第三步：提交前代码自检
```bash
node scripts/check_staged_rules.mjs
```
