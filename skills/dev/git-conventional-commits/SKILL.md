---
name: git-conventional-commits
namespace: dev
version: 1.0.0
skillType: rule
description: Conventional Commits 规范守门人
---

# Conventional Commits 提交规范守门人

在任何编写 Git 提交信息（Commit Message）、Pull Request 标题与变更日志场景中，AI 必须严格遵守以下规范。

## 一、 提交格式标准
```text
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

## 二、 允许的 Type 列表
- **`feat`**: 新功能（向后兼容，触发 semver minor）
- **`fix`**: 修复 Bug（触发 semver patch）
- **`docs`**: 仅文档变更
- **`style`**: 不影响代码运行的格式变动（空格、格式化、分号等）
- **`refactor`**: 代码重构（既不新增功能也不修 Bug）
- **`perf`**: 性能提升
- **`test`**: 添加或修改测试用例
- **`build`**: 影响构建系统或外部依赖的改动（npm, vite, webpack 等）
- **`ci`**: CI 配置文件和脚本变动（GitHub Actions 等）
- **`chore`**: 其他不修改 src 或测试文件的变动
- **`revert`**: 回退先前的提交

## 三、 破坏性变更 (Breaking Changes)
- 在 type/scope 后添加 `!`，或在 Footer 中写明 `BREAKING CHANGE: <说明>`（触发 semver major）。

## 四、 优秀范例 vs 反例
- ❌ **反例**: `git commit -m "update login and fixed bugs"`
- ❌ **反例**: `git commit -m "WIP"`
- ✅ **正例**: `feat(auth): support OAuth2 PKCE login flow`
- ✅ **正例**: `fix(parser): prevent crash on empty csv header`
- ✅ **正例**: `refactor(indexer)!: drop legacy sqlite schema v1`
