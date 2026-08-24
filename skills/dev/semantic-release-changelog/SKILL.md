---
name: semantic-release-changelog
description: 语义化版本号 (SemVer) 升级与基于 Conventional Commits 的自动化 CHANGELOG 生成规范。
---

# 语义化版本 (SemVer) 与自动化 CHANGELOG 规范

## 1. 语义化版本号计算法则 (`vMAJOR.MINOR.PATCH`)

| 提交类型 (Commit Type) | 触发版本号变更 | 示例 | 场景说明 |
| :--- | :---: | :--- | :--- |
| **`fix:` / `perf:`** | **PATCH** (v1.0.0 → v1.0.1) | `fix(auth): fix token expiration bug` | 向后兼容的缺陷修复与性能优化 |
| **`feat:`** | **MINOR** (v1.0.0 → v1.1.0) | `feat(payment): add Stripe webhook support` | 向后兼容的新功能引入 |
| **`BREAKING CHANGE:`** | **MAJOR** (v1.0.0 → v2.0.0) | `feat(api)!: remove deprecated v1 endpoint` | 不向后兼容的重大架构/API 变更 |

## 2. 自动化 CHANGELOG.md 格式规范

```markdown
## [1.2.0] - 2026-08-24

### 🚀 新特性 (Features)
- **payment**: 支持微信支付与支付宝 Native 扫码支付 ([#102](https://github.com/...))
- **auth**: 增加基于 WebAuthn 的通行密钥 (Passkey) 登录支持 ([#105](https://github.com/...))

### 🐛 缺陷修复 (Bug Fixes)
- **session**: 修复多标签页并发刷新 Token 时的竞争态死锁 ([#108](https://github.com/...))

### ⚡ 性能优化 (Performance Improvements)
- **search**: 引入 CJK 二元组与内存 BM25 混合检索，搜索耗时降低 75%
```
