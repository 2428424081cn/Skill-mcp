# Skill-MCP 设计文档

> 一句话定位：**把「技能」当作数据的 MCP 服务器**。AI 不再面对 1 万个 MCP 工具，而只面对 9 个元工具（检索/查看/获取/规划/执行/反馈/注册/统计），skill 的正文与代码按需拉取 —— 这是 Anthropic Agent Skills「渐进披露（progressive disclosure）」原则在 MCP 层的落地。
>
> 本文件是 v1 实现的蓝本：第 3 节逐一回答立项时提出的 8 个设计问题，第 4-6 节给出可实现的工具面、包格式与安全模型。

## 0. 与现有系统的差异

| 系统 | 做了什么 | 缺什么 |
| --- | --- | --- |
| skills.sh（Vercel）等市场 | skill 的分发与安装 | 任务级检索、组合、评价闭环 |
| AgentSkillsHub / OpenSkillsHub | skill 目录 + MCP 下载接口 | 适配判断、workflow、权限隔离 |
| anthropics/skills 官方仓库 | 高质量 skill 与格式规范 | 面向单 agent 挂载，无万级规模检索方案 |
| **Skill-MCP（本项目）** | **检索 + 适配 + 组合 + 评价闭环 + 版本/依赖 + 权限隔离，且全链路可降级（无 LLM / 无向量模型也能跑）** | —— |

## 1. 调研结论（2026 网络调研）

1. **Agent Skills 规范**：skill = 目录 + SKILL.md（YAML frontmatter：name/description/allowed-tools 等 + Markdown 正文）。模型靠描述按需加载正文，即渐进披露：**索引先于正文、正文先于执行**。Anthropic 官方仓库 anthropics/skills 的 discussion #1288「sparse activation + missed-case sweep + budgeted references」讨论了大库的结构化设计：稀疏激活（只加载相关的）、漏检清扫（检索失败时兜底）、预算化引用（控制上下文成本）——与本设计第 7 节对齐。
2. **MCP 规范**（modelcontextprotocol.io/specification）：server 通过 tools/list 一次性下发全部工具描述。推论：把每个 skill 注册成 MCP tool 在万级规模下必然撑爆上下文（Alibaba 工具路由研究报道：跳过全量工具装载可省 99% token）。skill 必须走「数据 + 检索」路线。
3. **组合路由**：Compositional Skill Routing（arXiv 2606.18051）——真实任务很少映射到单个 skill；正确流程是「分解任务 → 检索子技能 → 组合执行」。本设计第 5 节的 skill_plan 即此流程。
4. **评价排序**：LLM Routing with Dueling Feedback（arXiv 2510.00841）——用成对偏好反馈（哪个 skill 在同一任务上胜出）+ Elo/bandit 在线学习路由；Latency-Quality Routing（arXiv 2605.14241）——功能等价工具按延迟-质量联合评分排序。本设计第 6 节采用 Thompson sampling + Elo 双机制。
5. **安全**：OWASP MCP Security Cheat Sheet 与 OWASP GenAI 第三方 MCP 使用指南：工具投毒（tool poisoning）、提示注入、人机协同（HITL）是核心威胁；Microsoft agent-governance-toolkit 给出 MCP Security Gateway（代理式校验）模式。本设计第 8 节对齐。
6. **检索**：主流实践是 hybrid（BM25 + dense embedding）+ RRF 融合 + cross-encoder/LLM rerank（如 Chroma 的 RRF 文档、多个 SemEval 系统）。

## 2. 总体架构

~~~
                        ┌────────────────────────── Agent / MCP 客户端 ──────────────────────────┐
                        │   tools/list 永远只有 9 个元工具；skill 正文按需拉取（渐进披露）          │
                        └───────────────────────────────────┬────────────────────────────────────┘
                                                            │ MCP (stdio, JSON-RPC 2.0)
                        ┌───────────────────────────────────▼────────────────────────────────────┐
                        │                             Skill-MCP Server                           │
                        │  tools: search · inspect · get · plan · run · workflow_run ·           │
                        │         feedback · register · stats                                   │
                        │  resources: catalog · manifest · recipes · stats                       │
                        │  prompts: skill-briefing                                              │
                        ├────────────────────────────────────────────────────────────────────────┤
                        │  Registry ──► Indexer ──► Retriever ──► Planner ──► Executor           │
                        │  (版本/依赖)  (倒排+向量)  (漏斗+RRF)    (DAG)      (sandbox+预算)       │
                        │      ▲                                        │                        │
                        │      └────────── Telemetry ◄──── Evaluator ◄──┘                        │
                        │              (JSONL 日志)   (bandit / Elo / recipe 挖掘)               │
                        └─────────────────────────────────────────────────────────────────────────┘
~~~

模块职责：

| 模块 | 职责 |
| --- | --- |
| Registry | skill 包加载、内容寻址、版本管理、lockfile、依赖拓扑解析 |
| Indexer | 从 manifest 建倒排索引、合成 task_profile 并向量化、类目聚类 |
| Retriever | 三段式漏斗：确定性过滤 → 双路召回 + RRF → 启发式/LLM rerank |
| Planner | 任务适配打分、skill_plan 分解与图搜索、workflow DAG |
| Executor | skill_run / workflow_run：沙箱执行、预算强制、schema 校验、HITL |
| Evaluator | telemetry 聚合、Thompson/Elo 排名、Wilson 置信、recipe 挖掘 |
| Security | 三层权限求交（声明 ∩ 策略 ∩ 会话授权）、防注入 |

## 3. 八个设计问题的回答

### Q1 怎么检索 Skill —— 结论：三段式混合检索漏斗，每一层都能降级

纯 embedding 对专有名词/错误码/命令行旗标 recall 差；纯关键词对同义改写、意图泛化差；全量 LLM 打分成本不可接受。所以做成漏斗：

**L0 确定性过滤（成本≈0）**：倒排索引 over category / tags / triggers / capabilities / status / namespace；再用任务上下文预过滤（可用的 MCP server、已授权权限、项目类型）。命中即短名单，歧义查询才继续往下走。

**L1 双路召回 + RRF 融合**：
- 稀疏路：BM25-lite over 合成字段（name 权重 3、triggers/keywords 权重 2、description/useCases 权重 1）。

~~~
  IDF(t) = ln((N - n(t) + 0.5) / (n(t) + 0.5) + 1)
  score(d,q) = Σ_t IDF(t) * f(t,d) * (k1+1) / (f(t,d) + k1 * (1 - b + b * |d|/avgdl))   // k1=1.5, b=0.75
~~~

- 稠密路：embedding 的对象**不是 description，而是合成的 task_profile**：description + whenToUse + 全部 useCases + triggers + io.semanticType 拼接文本。向量余弦相似度。embedder 可插拔：默认零依赖 hashing-ngram 向量（离线可用），可选 OpenAI 兼容 API / 本地 transformers.js 模型。
- 融合：RRF（Reciprocal Rank Fusion），k=60。

~~~
  RRF(d) = Σ_{每个结果列表 r} 1 / (60 + rank_r(d))
~~~

**L2 rerank（只对 top-k≤20 打分）**：默认启发式打分器（字段加权匹配 + 适配信号 + 质量分，零成本）；配置了 LLM 时切换为 LLM reranker（结构化输出每条的 fit∈[0,1] 与 reason）。为什么不是全量 LLM：成本与延迟；为什么不是只靠 embedding：术语与反例信息 embedding 抓不住。

### Q2 怎么判断 Skill 是否适合当前任务 —— 结论：manifest 强制携带「正例 + 反例 + 前提」，fit 是五维加权

description 只回答「我是谁」，不回答「何时用我、用我需要什么」。所以 manifest 强制要求：

- whenToUse / whenNotToUse：正向与**负向**适配文本（负向匹配是 description-only 检索做不到的：任务与 whenNotToUse 语义相似 → 扣分）；
- useCases[]：具体任务正例（检索与 rerank 的主要语料）；
- preconditions：运行前提（需要哪些 MCP server / 工具 / 环境变量 / 文件）；
- io：输入输出的 semanticType + JSON Schema（用于组合，见 Q3）。

fit 打分（可解释，返回 fitReasons）：

~~~
  fit = 0.25 * 语义相似度(task vs task_profile)
      + 0.25 * 前提满足度(|可用能力 ∩ 所需能力| / |所需能力|)
      + 0.15 * IO 兼容性（任务的输出/输入类型与 skill 的输入/输出类型匹配）
      + 0.20 * 历史成功率（Wilson 下限，小样本不虚高）
      + 0.15 * LLM judge（可选；无 LLM 时该权重并入语义相似度）
~~~

产出：top-k 候选 + 每条 fitReasons + 「无匹配」信号。**错配的代价远大于漏配**（选了错 skill 会浪费执行与 token），所以允许返回空结果，precision 优先于 recall。

### Q3 Skill 怎么组合 —— 结论：类型兼容图 + 规划器，三轨并行

真实任务几乎不映射单个 skill（这正是 Compositional Skill Routing 论文的论点）。

- **显式契约**：每个 skill 声明 provides（产出的能力，如 "csv:parse"）与 consumes（需要的能力，如 "csv:raw"），以及 io 的 semanticType + schema。兼容性判断 = 结构兼容（schema 子集检查）**或**语义兼容（semanticType 向量相似度 > 阈值 θ）。
- **skill_plan（有 LLM）**：LLM 把任务分解为步骤（每步一个目标输出）→ 每步检索候选 skill → 用兼容图校验相邻步骤 → 输出 DAG。
- **skill_plan（无 LLM 降级）**：能力闭包图搜索（A*）。节点 = 能力状态，边 = skill（cost = 1/(fit*quality)），从当前可用输入出发搜到目标输出，产出最短路径 DAG。
- **workflow_run**：按拓扑序执行、ValueRef 数据流传参、失败重试、检查点记录、危险步骤 HITL 挂起。
- **第三轨 recipe**：从执行日志挖掘高频成功链 A→B→C（支持度/置信度/lift 达标）物化为 recipe；planner 优先复用 recipe（对 LLM 是 few-shot，对无 LLM 是现成路径）。

### Q4 Skill 怎么评价 —— 结论：每次调用都记账，双机制 ranking 回流检索

- **Telemetry（JSONL 追加）**：skill@version、任务文本、task 聚类号、outcome(success/failure/denied/timeout)、latency、cost、rating(1-5)、同任务败选对手（dueling 信号）。
- **在线排名双机制**：
  - Thompson sampling：每个 (skill, task 聚类) 维护 Beta(1+成功, 1+失败)，检索时采样一个 θ 作为探索/利用分——新 skill 自动获得探索机会，老 skill 凭实力胜出。
  - Elo（dueling feedback）：同一任务上 A 被选而 B 落选（或 A 评分高于 B），按 Elo 公式更新，K=32。

~~~
  E_A = 1 / (1 + 10^((R_B - R_A)/400));   R_A' = R_A + K * (S_A - E_A)
~~~

- **展示置信度**：Wilson 下限（z=1.96）防小样本虚高。
- **回流检索**：final = λ * retrievalScore + (1-λ) * qualityScore（聚类内归一，λ 默认 0.6）；失败自动触发备选检索；低分 skill 标记待 review。

### Q5 版本化与依赖管理 —— 结论：skill 即包，内容寻址 + lockfile + 拓扑解析

- **不可变版本**：manifest 版本号 + 全部文件内容 sha256。升级 = 注册新版本（append-only），旧版本永远可回滚、可审计。
- **依赖**：dependencies[] 每个是 { name, namespace, versionRange, kind }；kind=bundled（包内自含）或 external（运行时向 registry 解析）。resolver：取满足 range 的最高版本 → 循环检测 → 拓扑排序。provides/conflicts 做能力冲突检测（两个 skill 都 provides "pdf:render" 时提示冲突）。
- **lockfile**：解析后的版本集 + hash 锁定，保证可复现。
- **检索默认**：推荐最新 active 稳定版；任务显式 pin、或旧版本质量分更高时尊重旧版本。

### Q6 权限隔离 —— 结论：三层求交 + 默认拒绝 + 两段式 HITL

- **三层求交**：skill 声明（manifest.permissions：fs 路径、network 域名白名单、外部 MCP 工具引用、env、预算上限、mutating 标记）∩ admin 策略（allow/deny/ask 规则）∩ 会话授权（用户/agent 会话级 grant）。
- **默认拒绝**：写文件、网络、调用外部 MCP 工具必须显式声明；ask 策略命中时 skill_run 不执行，返回 requires_approval（附要申请的权限清单），用户批准后凭 grant token 重入——**先批后跑，两段式**。
- **执行隔离**：子进程沙箱执行；预算强制（maxDurationMs 超时 kill、maxCostCents 超额终止）；输出过 schema 校验才返回。
- **防注入**：skill 的输出只作为工具结果文本返回，绝不拼接进可执行位置；skill 调外部 MCP 一律经 broker 代理校验（对齐 OWASP 与 Microsoft MCP Security Gateway 模式）。

### Q7 怎么避免 Skill 爆炸（1 万个 skill）—— 结论：分层漏斗 + 两级索引 + 生命周期管理

- **上下文预过滤**：可用 MCP、已授权权限、项目类型先砍掉不相关的大半。
- **两级索引**：类目路由（类目 centroid 最近邻或小分类器，粗排 1 万 → 100）→ 簇内细搜（倒排 + 向量 + rerank）。1 万 skill 的检索延迟稳定在毫秒级。
- **倒排先行**：triggers/tags/capabilities 精确命中即出短名单；语义检索只兜底歧义查询（对齐 anthropics/skills #1288 的 sparse activation）。
- **近重复合并**：task_profile 向量相似 > 0.92 的聚簇，保留质量优胜者，其余 archived；missed-case sweep 定期把 archived 的 skill 拿出来过一遍检索日志看是否被漏检。
- **生命周期**：active / hidden / deprecated 三态；低用量 + 低成功率自动 hidden（可被显式检索召回）；deprecated 只在新版本引导中出现。
- **容量分层**：hot（活跃，全字段索引）/ warm（仅向量）/ cold（仅 manifest，按需加载）。
- **渐进披露的兜底效果**：无论库多大，tools/list 永远只有 9 个元工具，agent 上下文永远可控。

### Q8 Skill 是否应该自己学习/更新 —— 结论：元层自动学习，代码层门控更新

| 级别 | 内容 | 策略 |
| --- | --- | --- |
| L1 元数据学习 | ranking 更新、recipe 挖掘、曝光/采纳率监控、描述漂移检测（高曝光低采纳 → 标记需重写） | 自动 |
| L2 排序学习 | Thompson / Elo 在线更新 | 自动 |
| L3 组合学习 | 新 recipe 先 shadow（只建议不强制）→ 支持度/置信度达阈值转正式 | 半自动 |
| L4 代码更新 | skill 必须自带 tests；提案 → 沙箱 eval → 通过 → 人/agent 批准 → 注册新版本 | 门控 |

核心原则：**学习的主战场在检索/排序/组合（元层）；skill 代码的变更必须走版本化 CI 门，绝不原地静默修改**（append-only 保证可审计、可回滚）。描述漂移检测是 L1 里最有价值的一环：它同时是「检索质量」的自愈机制。

## 4. MCP 工具面

| 工具 | 用途 | 关键参数 | 返回 |
| --- | --- | --- | --- |
| skill_search | 按任务检索 skill | query, context, filters, topK | 候选列表：fit、fitReasons、retrieval/quality 分 |
| skill_inspect | 看 manifest（不加载正文） | key 或 name@version | manifest、依赖树、权限清单 |
| skill_get | 获取 skill 正文 | key 或 name@version | manifest + SKILL.md + 文件清单 + 已解析依赖摘要 |
| skill_plan | 任务 → workflow | task, context | DAG：nodes（skill+输入映射）、edges、假设、置信度 |
| skill_run | 执行单个 skill | skill, inputs, opts | 输出 或 requires_approval（HITL 挂起） |
| workflow_run | 执行 DAG | dag, inputs | 各节点结果 + 检查点 |
| skill_feedback | 反馈学习信号 | skill, outcome, rating, beatenBy | 更新后的排名摘要 |
| skill_register | 注册/升级 skill | manifest, files | 新 key、内容 hash、依赖解析结果 |
| skill_stats | 查看评价指标 | key? | 成功/失败/延迟/成本/曝光采纳/Elo |

资源：skills://catalog（全库 manifest 索引）、skills://manifest/{key}、skills://recipes（物化组合模式）、skills://stats/{key}。
Prompt：skill-briefing（给定任务，生成「先 skill_search 再动手」的引导提示）。

## 5. Skill 包格式

目录结构（Anthropic 风格兼容）：

~~~
skills/<namespace>/<name>/
  SKILL.md          # frontmatter(name/description/allowed-tools/license) + 正文（给 agent 读的玩法说明）
  skill.json        # 机器可读 manifest（检索/组合/权限的完整契约）
  src/              # 代码文件
  tests/            # 自带测试（L4 自更新的门）
~~~

skill.json 关键字段（完整类型见 src/types.ts 的 SkillManifest）：name、namespace、version、description、category、tags、triggers、keywords、whenToUse、whenNotToUse、useCases、preconditions、io(input/output 的 semanticType+schema)、capabilities、consumes、dependencies、permissions、entrypoint(inline/node/shell)、examples、status。
**SKILL.md 兼容策略**：只有 SKILL.md 没有 skill.json 时，用轻量 frontmatter 解析器提取标准字段并合成 manifest（缺省字段用安全默认值：无网络、无写、inline 执行）。

## 6. 安全模型（威胁 → 对策）

| 威胁 | 对策 |
| --- | --- |
| 工具投毒（skill 描述诱骗 agent 做坏事） | 描述只影响检索不直接进入可执行路径；执行必须过权限 broker；mutating 默认拒绝 |
| 提示注入（skill 正文/输出里藏指令） | 输出作为工具结果文本原样返回并标注来源；agent 侧提示要求把 skill 输出当数据不当指令 |
| 越权访问（skill 读写文件/网络） | 三层求交 + 域名/路径白名单 + ask 两段式 HITL |
| 资源耗尽 | maxDurationMs / maxCostCents 预算强制，超限 kill |
| 依赖投毒 | 内容寻址 + lockfile + external 依赖解析时校验 hash |
| 静默篡改 | append-only 注册 + content hash 校验 |

## 7. 实施路线

- **v1（本仓库）**：零依赖 Node 24 + 手写 MCP stdio 协议；Registry/Indexer/Retriever/Planner/Executor/Evaluator 全闭环；示例 skill 库（含依赖链、权限样例）；node --test 全量测试；无 LLM 可跑（默认 hashing 向量 + 启发式 rerank）。
- **v2（已落地）**：可插拔真实 embedding（OpenAI 兼容 API）与 LLM reranker/planner（v1 即有可插拔实现）；telemetry 换 SQLite（node:sqlite，启动自动迁移旧 JSONL）；workflow 拓扑分层并发执行（层内 Promise.all）；HTTP transport（Streamable HTTP，JSON/SSE 响应，零依赖 node:http）；grant token 过期/归属校验与复用。
- **v3（已落地）**：联邦 registry（config.remotes 签名 catalog 导入）；skill 签名验证（Ed25519 对包内容哈希签名，trust off/warn/enforce，发布者 TOFU 绑定）；L4 代码自更新门（版本升级须自带 tests 过沙箱，gate.testsRequired）；recipe shadow 模式全自动（RecipeStore 双阈值晋升/降级，data/recipes.json 持久化）。

## 8. 参考资料

- Agent Skills 格式规范：github.com/williamzujkowski/standards（SKILL_FORMAT_SPEC.md）、anthropics/skills 仓库及 discussion #1288（大库稀疏激活设计）
- Anthropic 企业级 Agent Skills 开放标准报道：techorange.com/2025/12/19/anthropic-launches-enterprise-agent-skills-and-opens-the-standard/
- MCP 规范：modelcontextprotocol.io/specification；服务器概念：modelcontextprotocol.io/docs/2025-06-18/learn/server-concepts
- Compositional Skill Routing for LLM Agents: Decompose, Retrieve, and Compose：arxiv.org/abs/2606.18051
- LLM Routing with Dueling Feedback：arxiv.org/abs/2510.00841
- Latency-Quality Routing for Functionally Equivalent Tools in LLM Agents：arxiv.org/abs/2605.14241
- Alibaba 工具路由省 token 99% 报道：venturebeat.com/orchestration/new-alibaba-ai-framework-skips-loading-every-tool-cutting-agent-token-use-99
- Hybrid Search with RRF：docs.trychroma.com/cloud/search-api/hybrid-search
- OWASP MCP Security Cheat Sheet：cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html；OWASP GenAI 第三方 MCP 使用指南：genai.owasp.org
- Microsoft agent-governance-toolkit MCP Security Gateway：github.com/microsoft/agent-governance-toolkit（tutorials/07）
- 同类系统：AgentSkillsHub / OpenSkillsHub（github.com/OpenSkillsHub/open-skills-hub）、skills.sh（dev.to 介绍）、AI Agent Skill 目录大全：agensi.io
