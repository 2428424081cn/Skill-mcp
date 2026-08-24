---
name: naming-conventions
description: 代码与变量命名规范守门人。强制 AI 遵循严格的变量命名、布尔值前缀（is/has/should）、函数动词规范与 Clean Code 准则。
---

# 代码与变量命名规范守则 (Naming Conventions)

在生成任何代码、重构模块或审查代码时，**必须无条件遵守以下命名法则**，坚决杜绝随意拼写、中英混杂与含义不清的缩写。

## 核心命名铁律

### 1. 布尔值必须具有“谓词前缀” (Boolean Predicates)
布尔变量或返回布尔值的函数必须能一眼看出返回 `true` 或 `false`：
- ❌ **严禁使用**：`const status = true;`, `const valid = ...;`, `const open = ...;`
- ✅ **强制使用**：
  - `is...`：状态判断（如 `isOpen`, `isLoading`, `isValid`, `isReady`）
  - `has...`：持有与归属（如 `hasPermission`, `hasChildren`, `hasError`）
  - `should...`：条件行为（如 `shouldAutoRetry`, `shouldRender`）
  - `can...`：能力与权限（如 `canEdit`, `canSubmit`）
  - `did...`：已发生状态（如 `didTimeout`, `didComplete`）

### 2. 函数/方法命名：动词 + 名词 (Verb + Noun)
函数必须清晰表达“对什么实体做了什么动作”：
- ❌ **严禁使用**：`function user() {}`, `const data = () => {}`, `function process() {}`
- ✅ **推荐动词列表**：
  - 查询获取：`getUserById()`, `fetchOrderList()`, `findActiveAccount()`
  - 创建与构建：`createInvoice()`, `buildSummaryReport()`
  - 修改与更新：`updateProfile()`, `setAuthToken()`
  - 校验与断言：`validateEmailAddress()`, `assertNonEmpty()`
  - 事件与回调：`handleSubmit()`, `onUserSelect()`, `handleError()`

### 3. 多语言命名风格对齐矩阵
| 语法实体 | TypeScript / JavaScript | Python (PEP 8) | Go | 规范示例 |
| :--- | :--- | :--- | :--- | :--- |
| **变量 / 属性** | `camelCase` | `snake_case` | `camelCase` / `PascalCase` | `userProfile`, `maxLimit` |
| **函数 / 方法** | `camelCase` | `snake_case` | `camelCase` / `PascalCase` | `calculateTotal()`, `get_user()` |
| **类 / 接口 / 类型**| `PascalCase` | `PascalCase` | `PascalCase` | `OrderService`, `UserProfile` |
| **React 组件 / Hook**| `PascalCase` / `useXxx`| - | - | `UserProfileCard`, `useAuth` |
| **全局不可变常量** | `SCREAMING_SNAKE` | `SCREAMING_SNAKE` | `PascalCase` / `SCREAMING` | `MAX_RETRY_COUNT`, `API_TIMEOUT_MS` |

### 4. 严禁无意义缩写与单字母变量
- ❌ **严禁**：`usr`, `mgr`, `btn_clk`, `tmp`, `chk_auth`, `const a = ...`
- ✅ **强制全拼**：`user`, `manager`, `handleButtonClick`, `temporaryBuffer`, `checkAuthentication`
- *(注：仅允许在极短的循环体内使用 `i`, `j` 作为下标计数器)*

---

## 自动化变量扫描工具

运行脚本自动扫描代码库中的不合规命名：
```bash
node scripts/audit_naming_rules.mjs <待扫描文件或目录>
```
