// Skill-MCP 核心类型契约：Registry / Indexer / Retriever / Planner / Executor / Evaluator 共享
// 运行于 Node 24 原生类型剥离（erasable syntax only：无 enum / namespace）

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: JsonValue[];
  description?: string;
  additionalProperties?: boolean;
}

export interface PermissionSet {
  fsRead: string[];       // 可读路径白名单
  fsWrite: string[];      // 可写路径白名单（空 = 禁止写）
  network: string[];      // 域名白名单；["*"] = 任意
  tools: string[];        // 可调用的外部 MCP 工具引用 "server:tool"
  env: string[];          // 可读环境变量
  maxDurationMs: number;  // 预算：最长执行时间
  maxCostCents: number;   // 预算：成本上限（估）
  mutating: boolean;      // 是否有副作用（默认应拒绝）
}

export interface SkillDependency {
  name: string;
  namespace: string;      // 空串 = 同 namespace
  versionRange: string;   // "1.2.3" | "^1.2.3" | "~1.2.3" | "1.x" | "*"
  kind: "bundled" | "external";
}

export interface SkillIO {
  semanticType: string;   // 如 "text" | "csv" | "json" | "html" | "image:png"
  schema?: JsonSchemaNode;
}

export interface SkillManifest {
  schemaVersion: 1;
  name: string;
  namespace: string;
  version: string;        // semver "1.2.3"
  description: string;    // 1-3 句：我是谁
  category: string;       // 类目路由桶
  tags: string[];
  triggers: string[];     // 精确召回关键词/片段（倒排先行）
  keywords: string[];
  whenToUse: string;      // 正向适配文本
  whenNotToUse: string;   // 反例/约束文本（负向匹配用）
  useCases: { task: string; steps?: string }[];
  preconditions: {
    mcpServers?: string[];
    tools?: string[];
    envVars?: string[];
    files?: string[];
  };
  io: { input: SkillIO; output: SkillIO };
  capabilities: string[]; // provides，如 "csv:parse"
  consumes: string[];     // 需要的能力，如 "csv:raw"
  dependencies: SkillDependency[];
  permissions: PermissionSet;
  entrypoint: {
    kind: "inline" | "node" | "shell";
    code?: string;        // kind=inline 时的 JS 代码（沙箱执行）
    file?: string;        // kind=node/shell 时的入口文件
    args?: string[];
  };
  tests?: { entry: string; timeoutMs?: number }; // L4 更新门：版本升级须自带测试入口（DESIGN Q8）
  examples?: { task: string; input?: JsonValue; output?: JsonValue }[];
  skillType?: "tool" | "rule";  // "tool"=按需搜索工具（默认）；"rule"=永远生效准则（跳过索引，每次 skill_search 自动附带）
  status?: "active" | "deprecated" | "hidden";
  author?: string;
  license?: string;
}

export interface SkillRecord {
  key: string;            // "namespace:name@version"
  manifest: SkillManifest;
  contentHash: string;    // 全部文件 sha256（内容寻址）
  dir: string;
  installedAt: number;
  profileText: string;    // 合成 task profile（embedding 目标，见 DESIGN.md Q1）
  files: Record<string, string>; // 相对路径 -> 内容（渐进披露：按需加载）
  vector?: number[];      // profileText 的向量缓存
}

export interface TaskContext {
  query: string;
  availableMcpServers?: string[];
  availableTools?: string[];
  grantedPermissions?: Partial<PermissionSet>;
  projectType?: string;
  preferredSkills?: string[];
  excludeSkills?: string[];
  hints?: string[];
}

export interface SkillHit {
  key: string;
  name: string;
  namespace: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  capabilities: string[];
  io: SkillManifest["io"];
  status: string;
  fit: number;            // 0..1 综合适配分
  fitReasons: string[];
  retrievalScore: number; // 检索得分（RRF+rerank）
  qualityScore: number;   // 质量分（Wilson/Bandit 合成）
  sem: number;            // 语义相似度
  lex: number;            // 词法得分
}

export interface ValueRef {
  step?: string;          // 引用某 step 的输出
  path?: string;          // 输出里的字段路径（点分）
  literal?: JsonValue;    // 字面量
}

export interface WorkflowNode {
  id: string;
  skillKey: string;
  inputs: Record<string, ValueRef>;
  requiresApproval?: boolean;
}

export interface WorkflowDag {
  id: string;
  nodes: WorkflowNode[];
  edges: [string, string][]; // [fromNodeId, toNodeId]
  assumptions: string[];     // 规划假设（供 agent 校验）
  confidence: number;        // 0..1
}

export interface InvocationLog {
  ts: number;
  runId: string;
  skillKey: string;
  taskText: string;
  cluster: number;        // 任务聚类号，-1 = 未聚类
  outcome: "success" | "failure" | "denied" | "timeout";
  latencyMs: number;
  costCents: number;
  rating?: number;        // 1..5
  beatenBy?: string;      // 同任务上胜出的其他 skill（dueling 信号）
  workflowId?: string;
}

export interface RankingStats {
  successes: number;
  failures: number;
  wins: number;           // dueling 胜场
  losses: number;
  elo: number;            // 初始 1500
  impressions: number;    // 曝光（进入候选列表）
  selections: number;     // 采纳（被执行）
  totalLatencyMs: number;
  totalCostCents: number;
  lastUsedAt: number;
}

export interface Embedder {
  name: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface RerankItem {
  index: number;          // hits 中的下标
  fit: number;            // 0..1
  reasons: string[];
}

export interface Reranker {
  name: string;
  rerank(query: string, ctx: TaskContext, hits: SkillRecord[]): Promise<RerankItem[]>;
}

// 检索漏斗输出的候选分（hybrid.ts 产出，fit.ts 消费）
export interface CandidateScore { key: string; lex: number; sem: number; fused: number }

// 确定性过滤条件（漏斗 L0）
export interface SearchFilters {
  categories?: string[];
  tags?: string[];
  statuses?: string[];
  capabilities?: string[];
  exclude?: string[];
}

// 两段式 HITL 授权令牌（security/permissions.ts 签发，tools 层校验）
export interface GrantToken { id: string; skillKey: string; granted: Partial<PermissionSet>; expiresAt: number }

// 沙箱执行结果（security/sandbox.ts 产出）
export interface RunResult {
  ok: boolean;
  output: JsonValue | null;
  error?: string;
  outcome: "success" | "failure" | "timeout" | "denied";
  latencyMs: number;
}

// 物化的 workflow 组合模式（eval/recipes.ts 挖掘）
export interface Recipe { id: string; chain: string[]; support: number; confidence: number; lift: number; hits: number; lastSeenAt: number }
