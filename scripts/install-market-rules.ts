// 批量安装市面顶级准则型 Skill 包 (skillType: "rule")
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface RuleDef {
  namespace: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  triggers: string[];
  whenToUse: string;
  whenNotToUse: string;
  skillMd: string;
  scriptFile?: string;
  scriptContent?: string;
}

const marketRules: RuleDef[] = [
  {
    namespace: "dev",
    name: "git-conventional-commits",
    version: "1.0.0",
    description: "Conventional Commits 提交规范守门人：强制统一 Git Commit Message 格式与语义化版本触发规范",
    category: "dev",
    tags: ["git", "commit", "conventional-commits", "rules", "standards"],
    triggers: ["commit", "git commit", "pr", "pull request", "changelog", "release"],
    whenToUse: "在生成 Git 提交说明、合并请求（PR/MR）描述或版本变更日志时必须遵守",
    whenNotToUse: "编写临时无版控脚本或单行命令调试时无需强制",
    scriptFile: "validate-commit.ts",
    scriptContent: `// Git Commit 规范自动化校验器
export function validateCommit(msg: string): { valid: boolean; error?: string } {
  const pattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\\([\\w\\-\\.]+\\))?!?: .+/;
  const lines = msg.trim().split('\\n');
  const header = lines[0];
  if (!pattern.test(header)) {
    return {
      valid: false,
      error: "Header 格式不符合规范: <type>(<optional scope>): <subject>。允许的 type: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert",
    };
  }
  if (header.length > 72) {
    return { valid: false, error: "Header 长度超过 72 字符限制（当前 " + header.length + " 字符）" };
  }
  return { valid: true };
}
`,
    skillMd: `---
name: git-conventional-commits
namespace: dev
version: 1.0.0
skillType: rule
description: Conventional Commits 规范守门人
---

# Conventional Commits 提交规范守门人

在任何编写 Git 提交信息（Commit Message）、Pull Request 标题与变更日志场景中，AI 必须严格遵守以下规范。

## 一、 提交格式标准
\`\`\`text
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
\`\`\`

## 二、 允许的 Type 列表
- **\`feat\`**: 新功能（向后兼容，触发 semver minor）
- **\`fix\`**: 修复 Bug（触发 semver patch）
- **\`docs\`**: 仅文档变更
- **\`style\`**: 不影响代码运行的格式变动（空格、格式化、分号等）
- **\`refactor\`**: 代码重构（既不新增功能也不修 Bug）
- **\`perf\`**: 性能提升
- **\`test\`**: 添加或修改测试用例
- **\`build\`**: 影响构建系统或外部依赖的改动（npm, vite, webpack 等）
- **\`ci\`**: CI 配置文件和脚本变动（GitHub Actions 等）
- **\`chore\`**: 其他不修改 src 或测试文件的变动
- **\`revert\`**: 回退先前的提交

## 三、 破坏性变更 (Breaking Changes)
- 在 type/scope 后添加 \`!\`，或在 Footer 中写明 \`BREAKING CHANGE: <说明>\`（触发 semver major）。

## 四、 优秀范例 vs 反例
- ❌ **反例**: \`git commit -m "update login and fixed bugs"\`
- ❌ **反例**: \`git commit -m "WIP"\`
- ✅ **正例**: \`feat(auth): support OAuth2 PKCE login flow\`
- ✅ **正例**: \`fix(parser): prevent crash on empty csv header\`
- ✅ **正例**: \`refactor(indexer)!: drop legacy sqlite schema v1\`
`,
  },
  {
    namespace: "dev",
    name: "typescript-strict-guard",
    version: "1.0.0",
    description: "TypeScript 严格类型防御准则：严禁 any 与隐式类型，强制类型收窄、Discriminated Unions 与不可变契约",
    category: "dev",
    tags: ["typescript", "strict", "types", "type-safety", "rules"],
    triggers: ["typescript", "ts", "interface", "type", "refactor", "code"],
    whenToUse: "在生成、重构或审查 TypeScript / JavaScript 代码时无条件执行",
    whenNotToUse: "编写纯 Bash/Shell 运维脚本时无需执行",
    skillMd: `---
name: typescript-strict-guard
namespace: dev
version: 1.0.0
skillType: rule
description: TypeScript 严格类型防御准则
---

# TypeScript 严格类型防御准则

在生成任何 TypeScript 代码时，AI 必须严格执行零妥协（Zero-Tolerance）类型安全规则。

## 一、 铁律（Zero Tolerance）
1. **严禁 \`any\`**：绝对禁止直接或间接使用 \`any\`。未知数据必须使用 \`unknown\` 并通过 Type Guard / Zod 校验收窄。
2. **严禁不安全断言**：禁止使用 \`as unknown as T\` 或随意使用非空断言 \`!\`（除非能严格证明其前置不变式）。
3. **强制导出显式返回类型**：所有导出的函数、类方法必须显式标注返回类型，严禁依赖隐式推导。
4. **不可变数据优先**：对象数组参数优先标注 \`readonly T[]\` 或 \`Readonly<T>\`，禁止在函数内直接 mutate 入参。

## 二、 核心设计模式要求
- **Discriminated Unions（可辨识联合）**：状态模型必须通过唯一的 \`kind\` / \`status\` / \`type\` 字段进行状态分支隔离。
- **\`satisfies\` 优于类型标注**：在需要保留字面量类型且满足契约时，优先使用 \`satisfies\` 操作符。

## 三、 范例对比
- ❌ **反例**:
\`\`\`typescript
function handleData(data: any) {
  return (data as any).user.name!;
}
\`\`\`
- ✅ **正例**:
\`\`\`typescript
interface UserData {
  user: { name: string };
}
function isUserData(obj: unknown): obj is UserData {
  return typeof obj === "object" && obj !== null && "user" in obj;
}
export function handleData(raw: unknown): string {
  if (!isUserData(raw)) throw new Error("Invalid payload");
  return raw.user.name;
}
\`\`\`
`,
  },
  {
    namespace: "web",
    name: "restful-api-standard",
    version: "1.0.0",
    description: "企业级 RESTful API 设计准则：强制 RFC 规范谓词语义、统一响应信封、幂等性与标准 HTTP 状态码",
    category: "web",
    tags: ["api", "rest", "http", "openapi", "standards", "rules"],
    triggers: ["api", "rest", "endpoint", "route", "http", "controller", "service"],
    whenToUse: "在设计、编写或重构 HTTP / RESTful API 接口时必须遵守",
    whenNotToUse: "编写 CLI 命令行工具或离线脚本时无需遵守",
    skillMd: `---
name: restful-api-standard
namespace: web
version: 1.0.0
skillType: rule
description: 企业级 RESTful API 设计准则
---

# 企业级 RESTful API 设计准则

在生成任何 API 接口、路由定义与控制器时，AI 必须严格执行以下设计标准。

## 一、 URL 命名与路由层级
1. **全名词复数**：使用资源复数名词，严禁在 URL 中出现动词（动词由 HTTP Method 表达）。
   - ❌ \`/api/getUserInfo\` / \`/api/deleteOrder\`
   - ✅ \`GET /api/v1/users/{id}\` / \`DELETE /api/v1/orders/{id}\`
2. **层级从属表达**：子资源嵌套在父资源之后。
   - ✅ \`GET /api/v1/users/{userId}/orders\`
3. **Kebab-Case**：URL 路径全小写并用连字符连接（如 \`/api/v1/payment-methods\`）。

## 二、 HTTP 谓词与状态码契约
- **\`GET\`**：安全且幂等，查询资源。\`200 OK\`
- **\`POST\`**：创建资源。成功返回 \`201 Created\` + \`Location\` 头。
- **\`PUT\`**：全量替换（幂等）。\`200 OK\` 或 \`204 No Content\`
- **\`PATCH\`**：局部更新。\`200 OK\`
- **\`DELETE\`**：删除资源（幂等）。成功返回 \`204 No Content\` 或 \`200 OK\`
- **错误状态码**：
  - \`400 Bad Request\`（参数格式错误）
  - \`401 Unauthorized\`（未认证/Token 失效）
  - \`403 Forbidden\`（已认证但无权限）
  - \`404 Not Found\`（资源不存在）
  - \`409 Conflict\`（唯一约束/状态机冲突）
  - \`422 Unprocessable Entity\`（业务逻辑校验失败）

## 三、 统一响应体信封 (Envelope)
\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  },
  "traceId": "c98a1f87-6e42-4b2a"
}
\`\`\`
`,
  },
  {
    namespace: "design",
    name: "modern-ui-aesthetics",
    version: "1.0.0",
    description: "现代 Web 美学与交互设计准则：强制 Design Tokens、微交互动画、WCAG 无障碍与高级视觉排版",
    category: "design",
    tags: ["ui", "ux", "css", "design-system", "aesthetics", "frontend", "rules"],
    triggers: ["ui", "frontend", "css", "html", "react", "vue", "web", "design"],
    whenToUse: "在编写前端页面、HTML/CSS 样式与 UI 组件时必须严格遵循",
    whenNotToUse: "编写纯后端无界面服务或底层数据管道时无需遵循",
    skillMd: `---
name: modern-ui-aesthetics
namespace: design
version: 1.0.0
skillType: rule
description: 现代 Web 美学与交互设计准则
---

# 现代 Web 美学与交互设计准则

在生成任何前端界面、Web 应用或 CSS 样式时，AI 必须拒绝平庸与廉价感，遵循顶级设计规范。

## 一、 色彩与 Design Tokens
1. **严禁硬编码随意颜色**：绝不允许在组件内随意手写 \`#ff0000\`、\`#3b82f6\`。必须使用 CSS 变量或语义化 Token（如 \`--color-primary\`, \`--color-surface-elevated\`）。
2. **Dark Mode 原生支持**：使用 HSL 色彩空间构建色彩梯度，确保亮色/暗色模式对比度达到 WCAG 2.1 AA 级（文本对比度 >= 4.5:1）。
3. **层次与玻璃拟态 (Glassmorphism)**：巧妙结合 \`backdrop-filter: blur()\` 与半透明边框，营造精致空间深度。

## 二、 8pt 网格与排版层级
1. **间距阶梯**：所有 \`margin\`、\`padding\`、\`gap\` 必须基于 4px / 8px 的倍数阶梯（4, 8, 12, 16, 24, 32, 48, 64px）。
2. **现代无衬线字体**：优先采用 Inter, Roboto, Plus Jakarta Sans, Outfit 或系统原生字体栈，禁止使用浏览器粗糙默认字体。

## 三、 微交互与动态响应 (Micro-Interactions)
1. **一切可交互元素必须有状态响应**：\`hover\`、\`focus-visible\`、\`active\`、\`disabled\` 状态必须具备平滑过渡动画（150ms ~ 250ms \`cubic-bezier(0.4, 0, 0.2, 1)\`）。
2. **触觉反馈与防抖动**：按钮点击时可配合微小缩放（\`transform: scale(0.98)\`），禁止在 hover 时触发因边框增厚导致的页面布局抖动（Layout Shift）。
`,
  },
  {
    namespace: "reasoning",
    name: "chain-of-verification",
    version: "1.0.0",
    description: "Chain-of-Verification (CoVe) 验证链准则：生成草案 -> 提出自验问题 -> 独立求证 -> 纠偏合成四步验证闭环",
    category: "reasoning",
    tags: ["reasoning", "cove", "verification", "hallucination-prevention", "rules"],
    triggers: ["verify", "fact", "logic", "check", "architecture", "solve", "math", "analysis"],
    whenToUse: "在处理复杂技术选型、高风险算法推导或易产生幻觉的关键事实推断时执行",
    whenNotToUse: "简单文本格式化或固定样板代码生成时无需多轮验证",
    skillMd: `---
name: chain-of-verification
namespace: reasoning
version: 1.0.0
skillType: rule
description: Chain-of-Verification (CoVe) 验证链准则
---

# Chain-of-Verification (CoVe) 验证链思维准则

为彻底消除大模型在复杂推导、关键技术方案与算法编写中的**事实幻觉与逻辑漏洞**，AI 必须遵守 Meta CoVe 四步验证机制。

## 一、 四步闭环流程
\`\`\`text
┌─────────────────┐      ┌─────────────────────────┐
│ 1. 拟定初始基线 │ ───> │ 2. 构建对抗性质询清单   │
│   (Draft Output)│      │  (Verification Query)   │
└─────────────────┘      └─────────────────────────┘
                                      │
                                      ▼
┌─────────────────┐      ┌─────────────────────────┐
│ 4. 纠偏合成终稿 │ <─── │ 3. 剥离假设独立求证     │
│ (Final Verified)│      │  (Fact/Invariant Check) │
└─────────────────┘      └─────────────────────────┘
\`\`\`

## 二、 实践步骤
1. **生成初步方案 (Draft)**：快速给出第一版实现或结论。
2. **自动提炼验证问题**：
   - 这个问题的时间复杂度和空间复杂度在最坏情况下真的是 O(N) 吗？
   - 并发调用时是否存在未加锁的竞态状态？
   - 外部依赖挂掉时是否会导致整个进程死锁？
3. **独立回答验证问题**：不依赖先前的草案假设，重新从公理/代码逻辑推导答案。
4. **纠偏合并**：若发现原草案存在漏洞，主动推翻并给出修正后的最终方案。
`,
  },
  {
    namespace: "arch",
    name: "clean-code-solid",
    version: "1.0.0",
    description: "Clean Code & SOLID 架构设计准则：单一职责、开闭原则、依赖倒置与控制认知复杂度",
    category: "arch",
    tags: ["architecture", "solid", "clean-code", "refactoring", "patterns", "rules"],
    triggers: ["architecture", "refactor", "design", "class", "module", "clean-code"],
    whenToUse: "在编写系统模块、类设计、函数抽象或重构遗留代码时必须遵循",
    whenNotToUse: "编写 10 行以内的单次运行临时验证脚本时无需过度分层",
    skillMd: `---
name: clean-code-solid
namespace: arch
version: 1.0.0
skillType: rule
description: Clean Code & SOLID 架构设计准则
---

# Clean Code & SOLID 架构设计准则

在生成任何工程级模块、类与函数时，AI 必须严格执行以下设计准则。

## 一、 SOLID 五大原则落实
1. **Single Responsibility (单一职责)**：一个函数/类只做一件事，只有一个发生变动的理由。单个函数长度控制在 30 行以内。
2. **Open/Closed (开闭原则)**：对扩展开放，对修改关闭。通过策略模式（Strategy）或多态接口扩展新功能，禁止在业务函数内堆砌巨大的 \`switch-case\` / \`if-else\`。
3. **Liskov Substitution (里氏替换)**：子类必须可以无缝替换基类而不破坏程序正确性，严禁子类抛出 \`NotImplementedException\`。
4. **Interface Segregation (接口隔离)**：胖接口拆分为瘦接口。客户端不应该被迫依赖它用不到的方法。
5. **Dependency Inversion (依赖倒置)**：高层业务模块不依赖底层实现（如具体数据库、第三方 SDK），二者均依赖抽象接口。

## 二、 认知复杂度 (Cognitive Complexity) 控制
- 严禁超过 3 层以上的条件嵌套。
- 采用 **Early Return（卫语句优先）** 模式，前置抛出异常或返回，保持主干逻辑平铺。
- 禁止魔法数字（Magic Numbers），常量必须具备语义化命名。
`,
  },
];

let totalInstalled = 0;

for (const rule of marketRules) {
  const dir = join("skills", rule.namespace, rule.name);
  mkdirSync(dir, { recursive: true });

  // 1. 生成 skill.json
  const manifest = {
    schemaVersion: 1,
    name: rule.name,
    namespace: rule.namespace,
    version: rule.version,
    description: rule.description,
    category: rule.category,
    tags: rule.tags,
    triggers: rule.triggers,
    keywords: rule.tags,
    whenToUse: rule.whenToUse,
    whenNotToUse: rule.whenNotToUse,
    skillType: "rule",
    useCases: [{ task: rule.description }],
    preconditions: {},
    io: {
      input: { semanticType: "text" },
      output: { semanticType: "text" },
    },
    capabilities: [rule.namespace + ":" + rule.name],
    consumes: [],
    dependencies: [],
    permissions: {
      fsRead: ["*"],
      fsWrite: [],
      network: [],
      tools: [],
      env: [],
      maxDurationMs: 5000,
      maxCostCents: 0,
      mutating: false,
    },
    entrypoint: { kind: "inline", code: "return { applied: true, rule: '" + rule.namespace + ":" + rule.name + "' };" },
    status: "active",
  };

  writeFileSync(join(dir, "skill.json"), JSON.stringify(manifest, null, 2), "utf8");

  // 2. 生成 SKILL.md
  writeFileSync(join(dir, "SKILL.md"), rule.skillMd.trim() + "\n", "utf8");

  // 3. 生成 scripts (如有)
  if (rule.scriptFile && rule.scriptContent) {
    const scriptsDir = join(dir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, rule.scriptFile), rule.scriptContent.trim() + "\n", "utf8");
  }

  totalInstalled++;
  console.log("Installed Rule Skill: [" + rule.namespace + ":" + rule.name + "]");
}

console.log("\nTotal Market Rules Installed:", totalInstalled);
