# Skill-MCP 🚀
> **把技能当作数据的下一代 AI Agent 技能注册中心与认知准则引擎**
> Next-Gen AI Agent Skill Registry & Cognitive Rule Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=24](https://img.shields.io/badge/Node->=24-green.svg)](https://nodejs.org)
[![MCP Protocol](https://img.shields.io/badge/MCP-2025--06--18-orange.svg)](https://modelcontextprotocol.io)
[![Tests: 91 Passing](https://img.shields.io/badge/Tests-91%20Pass-brightgreen.svg)]()

---

## 📖 核心理念与架构革新

传统的 Agent 技能生态面临两大行业痛点：
1. **技能检索低效**：简单的关键词匹配无法应对长尾需求，多技能串联缺乏依赖解析与数据流规划能力。
2. **准则型规范缺失**：命名准则、代码审查、深度思考、提交规范等“规矩（Rules）”，在没有明确触发词时，AI **几乎永远不会主动调用**。

**Skill-MCP** 提出了**「双轨制技能架构（Dual-Track Skill Architecture）」**：

```text
                               ┌───────────────────────────┐
                               │   AI Client (Claude/Cursor)│
                               └─────────────┬─────────────┘
                                             │
                                     skill_search("...")
                                             │
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │                 Skill-MCP                    │
                      ├──────────────────────┬───────────────────────┤
                      │                      │                       │
     【按需检索】      ▼                      ▼     【强制注入】       │
  ┌─────────────────────────┐         ┌────────────────────────────┐ │
  │    Tool Skills (工具型)  │         │     Rule Skills (准则型)   │ │
  ├─────────────────────────┤         ├────────────────────────────┤ │
  │ • BM25 + 向量混合召回   │         │ • 跳过搜索竞争             │ │
  │ • 多技能工作流 DAG 规划 │         │ • 随每次检索无条件跟车附带 │ │
  │ • 沙箱隔离与 HITL 权限  │         │ • 强制规范 AI 思考与代码风格│ │
  └───────────┬─────────────┘         └────────────┬───────────────┘ │
              │                                    │                 │
              └──────────────────┬─────────────────┘                 │
                                 ▼                                   │
                      ┌──────────────────────┐                       │
                      │ 统一 Payload 返回给 AI│                       │
                      └──────────────────────┘                       │
                      └──────────────────────────────────────────────┘
```

---

## 📐 Skill-MCP 技能标准规范 (The Skill Standard)

所有存放在 `skills/` 下的技能均采用统一的**「三位一体」**组织标准：

```text
skills/<namespace>/<skill-name>/
├── skill.json         # 1. 机器契约（元数据、IO Schema、权限、执行入口、skillType）
├── SKILL.md           # 2. AI 执行 SOP 指南（角色定位、正反例、步骤规范）
└── scripts/           # 3. 可执行脚本工具（自动化校验器、数据抓取脚本、转换器等）
    └── run.ts
```

### 1. `skill.json` 契约定义

```jsonc
{
  "schemaVersion": 1,
  "name": "naming-conventions",
  "namespace": "dev",
  "version": "1.0.0",
  "description": "代码与变量命名规范守门人：强制统一 AI 代码命名风格，约束布尔谓词、函数动词前缀与常量大写。",
  "category": "dev",
  "tags": ["naming-conventions", "code-style", "rules"],
  "triggers": ["naming", "variable", "refactor", "code"],
  "keywords": ["naming", "camelCase", "snake_case"],
  "whenToUse": "在生成、重构或审查任何编程语言的代码时必须遵守",
  "whenNotToUse": "编写纯文本说明或无代码生成的闲聊场景无需遵守",
  
  // 核心区分：'tool' (按需搜索工具) | 'rule' (永远生效的准则)
  "skillType": "rule",

  "useCases": [
    { "task": "审查并规范生成的变量与函数命名" }
  ],
  "preconditions": {},
  "io": {
    "input": { "semanticType": "text" },
    "output": { "semanticType": "text" }
  },
  "capabilities": ["dev:naming-conventions"],
  "consumes": [],
  "dependencies": [],
  "permissions": {
    "fsRead": ["*"],
    "fsWrite": [],
    "network": [],
    "tools": [],
    "env": [],
    "maxDurationMs": 5000,
    "maxCostCents": 0,
    "mutating": false
  },
  "entrypoint": {
    "kind": "inline",
    "code": "return { applied: true, rule: 'dev:naming-conventions' };"
  },
  "status": "active"
}
```

### 2. `SKILL.md` 编写规范
- **Frontmatter**：包含 `name`, `namespace`, `version`, `skillType`, `description`。
- **正向规范 (Do's)**：分点列出明确的行为守则。
- **反例对照 (Bad vs Good)**：必须提供显式的对比代码块，消除 LLM 理解歧义。

---

## 🛠️ MCP 工具矩阵 (9 Tools)

| 工具名称 | 职责定位 |
| :--- | :--- |
| **`skill_search`** | 混合检索工具型技能，并**自动注入全局生效的准则型技能（`activeRules`）** |
| **`skill_inspect`** | 查看技能依赖拓扑、版本冲突、循环依赖与文件哈希 |
| **`skill_get`** | 获取技能的完整 `SKILL.md` SOP 手册与上下文指令 |
| **`skill_plan`** | 基于拓扑图与历史成功配方（Recipes），自动规划多技能 DAG 数据流工作流 |
| **`skill_run`** | 在安全沙箱（Node/Inline/Shell）中单步执行技能，受权限模型（Broker）管控 |
| **`workflow_run`** | 编排执行完整的工作流 DAG，支持两阶段人工介入授权（HITL） |
| **`skill_feedback`** | 上报技能执行反馈，触发 Thompson Sampling 与 Elo 胜率动态重排 |
| **`skill_register`** | 动态注册新技能，支持内容寻址、TOFU 签名绑定与质量门禁 |
| **`skill_stats`** | 查看技能的历史调用频次、胜率、Elo 分数与热门技能配方 |

---

## 🚀 快速上手

### 环境要求
- **Node.js**: `>= 24.0.0` (原生支持 TypeScript 类型剥离与 SQLite)

### 1. 本地运行 (Stdio 模式)
直接作为本地 MCP 服务集成到 Claude Desktop 或 Cursor：

```bash
# 安装依赖
npm install

# 运行测试套件（91 项自动化测试）
npm test

# 启动 Stdio MCP 服务
npm start
```

### 2. 本地/服务器 HTTP 模式 (Streamable HTTP / SSE)

```bash
# 启动 HTTP 服务，监听 0.0.0.0:3000
node src/main.ts --http --host 0.0.0.0 --port 3000
```

服务就绪端点：`http://127.0.0.1:3000/mcp` (支持 JSON-RPC 与 Server-Sent Events 流式响应)。

---

## 🐳 Docker 部署

```bash
# 构建镜像
docker build -t skill-mcp:latest .

# 后台运行容器（数据持久化挂载）
docker run -d \
  -p 3000:3000 \
  --name skill-mcp \
  -v $(pwd)/data:/app/data \
  skill-mcp:latest
```

---

## 🔌 客户端配置示例

### Claude Desktop (`claude_desktop_config.json`)

#### 本地进程方式 (Stdio):
```json
{
  "mcpServers": {
    "skill-mcp": {
      "command": "node",
      "args": ["/path/to/Skill-mcp/src/main.ts"]
    }
  }
}
```

#### 远程服务器方式 (HTTP):
```json
{
  "mcpServers": {
    "remote-skill-mcp": {
      "url": "http://your-server-ip:3000/mcp"
    }
  }
}
```

---

## 🛡️ 准则型技能生态 (Built-in Rule Skills)

当前内置了 **13 套顶级认知与工程守门人准则**：

- 🌟 **Git 提交规范**：`dev:git-conventional-commits`
- 🌟 **类型安全防御**：`dev:typescript-strict-guard`
- 🌟 **代码命名守门**：`dev:naming-conventions`
- 🌟 **代码安全审查**：`dev:code-review-guard`
- 🌟 **SOLID 架构准则**：`arch:clean-code-solid`
- 🌟 **企业级 RESTful**：`web:restful-api-standard`
- 🌟 **现代 Web 美学**：`design:modern-ui-aesthetics`
- 🧠 **验证链思考 (CoVe)**：`reasoning:chain-of-verification`
- 🧠 **动态思维链**：`reasoning:sequential-thinking`
- 🧠 **丰田 5-Whys**：`reasoning:root-cause-5whys`
- 🧠 **魔鬼代言人 (对抗)**：`reasoning:adversarial-critic`
- 🧠 **第一性原理推导**：`reasoning:first-principles`
- 🧠 **多准则量化决策**：`reasoning:decision-tradeoff-matrix`

---

## 📄 开源许可证
本项目基于 [MIT License](LICENSE) 开源发布。
