// 纯 ESM 零依赖的 ESA 构建器：支持【三层通用方案】
// Part A: 索引时 IDF 自动合成 Triggers (独占词发现)
// Part B: 查询时全局同义词典扩展 (α=0.4 对称展开)
// Part C: 3 闸通用拒识层 (Rule 移出普通检索池 + 地板分 + 平坦度检查)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { STOPWORDS, segment } from "./lib/segment.mjs";

console.log("== [ESA Cloud Build] 开始构建 Skill-MCP 边缘分发包 (三层通用检索架构) ==");

const skillsDir = join(process.cwd(), "skills");


function hashVector(tokens, dim = 2048) {
  const v = new Array(dim).fill(0);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = (h ^ (h >>> 13)) >>> 0;
    v[h % dim] += 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < dim; i++) v[i] /= norm; }
  return v;
}

// 1. 递归扫描 skills/ 目录下的所有技能
const skills = [];

function scanDir(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  const hasSkillJson = entries.some((e) => e.isFile() && e.name === "skill.json");

  if (hasSkillJson) {
    try {
      const manifestPath = join(dir, "skill.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const files = {};

      function readFilesRecursive(subDir, prefix = "") {
        for (const ent of readdirSync(subDir, { withFileTypes: true })) {
          const rel = prefix ? prefix + "/" + ent.name : ent.name;
          const full = join(subDir, ent.name);
          if (ent.isDirectory()) {
            readFilesRecursive(full, rel);
          } else if (ent.isFile()) {
            files[rel] = readFileSync(full, "utf8");
          }
        }
      }

      readFilesRecursive(dir);

      const skillMd = files["SKILL.md"] || "";
      const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
      const key = (manifest.namespace ? manifest.namespace + ":" : "") + manifest.name + "@" + (manifest.version || "1.0.0");

      skills.push({
        key,
        manifest,
        contentHash: hash,
        installedAt: Date.now(),
        files
      });
    } catch (e) {
      console.warn("Skipping invalid skill at:", dir, e.message);
    }
    return;
  }

  for (const ent of entries) {
    if (ent.isDirectory()) scanDir(join(dir, ent.name));
  }
}

scanDir(skillsDir);
console.log(`[1/3] 成功扫描并加载 ${skills.length} 个 Skill`);

// ─────────────────────────────────────────────────────────────
// Part A: 索引时统计全库 IDF 并自动合成每技能独占 Triggers
// ─────────────────────────────────────────────────────────────
console.log("[2/3] 正在通过全库 IDF 统计自动合成技能独占词 (Auto-Synthetic Triggers)...");

// Pass 1: 统计全库 Document Frequency (DF)
const dfMap = new Map();
for (const s of skills) {
  const m = s.manifest;
  const md = s.files["SKILL.md"] || "";
  const docTokens = new Set(segment([m.name, m.description || "", m.whenToUse || "", md.slice(0, 1000)].join(" ")));
  for (const t of docTokens) {
    dfMap.set(t, (dfMap.get(t) || 0) + 1);
  }
}

const N = skills.length;
const getIDF = (t) => Math.log((N - (dfMap.get(t) || 0) + 0.5) / ((dfMap.get(t) || 0) + 0.5) + 1);

// Pass 2: 为每个技能挑 Top-8 独占度最高的特征词合成 triggers
for (const s of skills) {
  const m = s.manifest;
  const md = s.files["SKILL.md"] || "";
  const desc = (m.description || "") + " " + (m.whenToUse || "");
  const descTokens = segment(desc);

  const cand = new Map();
  for (const t of descTokens) {
    if (STOPWORDS.has(t) || t.length < 2 || /^\d+$/.test(t)) continue;
    const termIdf = getIDF(t);
    if (!/^[a-z]/i.test(t) && termIdf < 1.0) continue; // 中文词需具备一定独占度

    // 术语得分 = 词频 * IDF * 位置加权 (前半部分核心词权重 1.2)
    const posBonus = desc.indexOf(t) < desc.length / 2 ? 1.2 : 1.0;
    cand.set(t, (cand.get(t) || 0) + termIdf * posBonus);
  }

  const syntheticTriggers = Array.from(cand.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t);

  s.syntheticTriggers = syntheticTriggers;

  // 向量计算 (包含合成独占词)
  const profileParts = [
    m.name,
    m.namespace || "",
    m.category || "",
    m.description || "",
    m.whenToUse || "",
    (m.triggers || []).join(" "),
    syntheticTriggers.join(" "),
    (m.keywords || []).join(" "),
    (m.tags || []).join(" "),
    md.slice(0, 1200)
  ];
  s.vector = hashVector(segment(profileParts.join(" ")), 2048);
}

// ─────────────────────────────────────────────────────────────
// Part B & C: 生成 Worker 运行时脚本 (含全局同义词典与 3 闸拒识层)
// ─────────────────────────────────────────────────────────────
const workerSource = `// Skill-MCP 边缘分发网关 (Aliyun ESA / Cloudflare Workers)
// 包含 ${skills.length} 个精选技能，内置三层通用检索与拒识架构 v6：
// 1. 索引时 IDF 自动合成 Triggers (合成词走 1.5 权重 BM25)
// 2. 查询时全局同义词典扩展 (α=0.4 对称展开)
// 3. 两阶段打分：原始分管准入（FLOOR_RAW=0.35 + 平坦度闸），惩罚（rule -0.15 / cov 罚）只管排序
// 4. 分词器 v6：与构建侧 scripts/lib/segment.mjs 同源对称；
//    刀1 填充 bigram 过滤（长句覆盖率分母只剩内容词，治自然语言稀释）+
//    刀2 CJK↔拉丁边界必切（"找bug" -> 找+bug，混合 token 两侧永不错位）

const SKILLS = ${JSON.stringify(skills)};

const CJK_RE = /[\\u4e00-\\u9fff]/;

const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "么", "怎", "才", "做", "把", "给", "让", "被", "及", "等", "与", "或", "什么", "怎么", "如何", "怎样", "为什么", "推荐", "几个", "几部", "今天", "明天", "需要", "带", "请问", "帮我", "一下", "可以", "怎么做", "支持", "提供", "使用", "进行", "相关", "问题", "处理", "实现", "工具", "助手", "功能", "基于", "用于",
  // v6 刀1 补充（第五轮探针实证的高频填充成分）
  "个", "这个", "那个", "是不是", "有没有"
]);

// 单字停用子集：用于填充 bigram 判定（bigram 任一字命中即视为跨字噪声）—— 刀1
const SINGLE_STOP = new Set([...STOPWORDS].filter((w) => w.length === 1));

function isFillerBigram(b) {
  return SINGLE_STOP.has(b[0]) || SINGLE_STOP.has(b[1]);
}

// 刀2：把混合词按 CJK / 拉丁数字边界切开（"找bug" -> ["找","bug"]；"vue3" 整段拉丁保持）
function splitRuns(w) {
  const parts = [];
  let cur = "";
  let curCJK = null;
  for (const ch of w) {
    const c = CJK_RE.test(ch);
    if (curCJK === null || c === curCJK) {
      cur += ch;
    } else {
      parts.push(cur);
      cur = ch;
    }
    curCJK = c;
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

// Part B: 全局同义词典 (语言层通用资产，零技能耦合)
const SYNONYMS = {
  // 命名与标识
  "起名": ["命名", "取名"], "取名": ["命名", "起名"], "起个名字": ["命名", "取名"], "叫什么好": ["命名"],
  "变量名": ["标识符", "命名"], "函数名": ["方法名", "命名"], "函数命名": ["命名"],
  // 密码与安全
  "写死": ["硬编码", "明文"], "硬编码": ["写死", "明文"], "明文密码": ["硬编码", "敏感信息"], "揪出来": ["扫描", "检测"],
  "查密": ["密钥", "凭据", "扫描"], "token泄露": ["密钥", "凭据", "泄露"], "泄漏": ["泄露"],
  // 调试与排查
  "没头绪": ["排查", "定位", "根因"], "找bug": ["调试", "排查", "定位"], "排查": ["定位", "诊断"], "定位问题": ["排查", "根因"],
  "为什么报错": ["根因", "排查"], "卡死": ["无响应", "死锁", "挂起"], "慢查询": ["慢sql", "查询优化"],
  // 决策与对比
  "纠结": ["权衡", "对比", "选型"], "选不准": ["权衡", "对比", "选型"], "怎么选": ["选型", "权衡", "对比"],
  "哪个好": ["对比", "权衡"], "优缺点": ["权衡", "利弊", "对比"],
  // 审查与重构
  "挑刺": ["审查", "批判", "找茬"], "帮我看看": ["审查", "检查"], "代码太乱": ["重构", "解耦", "solid"],
  "坏味道": ["代码异味", "代码质量"], "瘦身": ["优化", "精简", "减小体积"], "提速": ["优化", "加速", "性能"],
  // 前端与交互
  "弹窗": ["对话框", "模态框", "dialog"], "下拉菜单": ["dropdown", "select"], "好看": ["美学", "现代ui"],
  // 并发与后端
  "协程泄露": ["goroutine", "并发安全"], "并发锁": ["互斥锁", "并发安全"], "死锁": ["并发安全", "死锁"],
  // 版本与发布
  "发版": ["发布", "版本号", "release"], "更新日志": ["changelog", "版本日志"]
};

const SYN_ALPHA = 0.4; // 同义词扩展权重

// 修 3 不变量 + v6 两刀：运行时分词器与构建时共用同一算法 —— 本块是 scripts/lib/segment.mjs 的镜像副本，
// 两侧行为必须逐字一致（改动任何一侧都要同步另一侧，test-tokenizer.mjs 负责从产物侧验证）。
function segment(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\\u4e00-\\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    for (const part of splitRuns(w)) {
      if (part === "") continue;
      if (CJK_RE.test(part)) {
        if (part.length === 1) {
          if (!SINGLE_STOP.has(part)) out.push(part);
        } else {
          for (let i = 0; i < part.length - 1; i++) {
            const bigram = part.slice(i, i + 2);
            if (!STOPWORDS.has(bigram) && !isFillerBigram(bigram)) out.push(bigram);
          }
        }
      } else {
        out.push(part);
        if (part.length > 4) {
          for (let i = 0; i < part.length - 2; i++) out.push(part.slice(i, i + 3));
        }
      }
    }
  }
  return out;
}

// 查询同义词扩展
function expandQueryTokens(tokens, rawQuery) {
  const tokenWeights = new Map();
  for (const t of tokens) tokenWeights.set(t, 1.0);

  // 1. 分词级同义词展开
  for (const t of tokens) {
    const syns = SYNONYMS[t] || [];
    for (const s of syns) {
      for (const st of segment(s)) {
        if (!tokenWeights.has(st)) tokenWeights.set(st, SYN_ALPHA);
      }
    }
  }

  // 2. 原文短语级同义词展开
  const ql = rawQuery.toLowerCase();
  for (const [phrase, syns] of Object.entries(SYNONYMS)) {
    if (ql.includes(phrase)) {
      for (const s of syns) {
        for (const st of segment(s)) {
          if (!tokenWeights.has(st)) tokenWeights.set(st, SYN_ALPHA);
        }
      }
    }
  }

  return tokenWeights;
}

function hashVector(tokens, dim = 2048) {
  const v = new Array(dim).fill(0);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = (h ^ (h >>> 13)) >>> 0;
    v[h % dim] += 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < dim; i++) v[i] /= norm; }
  return v;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

// 内存 BM25 倒排索引
class InvertedIndex {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.postings = new Map();
    this.lens = new Map();
    this.avgdl = 0;
  }

  add(key, fields) {
    let total = 0;
    for (const field of fields) {
      // 修 3：所有字段（name/triggers/keywords/tags/desc/SKILL.md）入倒排前统一走 segment()，
      // 与查询侧同一分词器 —— triggers 里的「正则卡死」以 正则/则卡/卡死 入索引，查询侧 bigram 才撞得上。
      const tokens = segment(field.text);
      total += tokens.length;
      const freq = new Map();
      for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
      for (const [term, f] of freq) {
        let m = this.postings.get(term);
        if (!m) { m = new Map(); this.postings.set(term, m); }
        m.set(key, (m.get(key) || 0) + field.weight * f);
      }
    }
    this.lens.set(key, total);
    let sum = 0;
    for (const len of this.lens.values()) sum += len;
    this.avgdl = this.lens.size > 0 ? sum / this.lens.size : 0;
  }

  search(weightedTokens) {
    if (!weightedTokens || weightedTokens.size === 0) return [];
    const N = this.lens.size;
    const scores = new Map();
    const matchCounts = new Map();

    for (const [t, w] of weightedTokens.entries()) {
      const m = this.postings.get(t);
      if (!m) continue;
      const nq = m.size;
      const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1);
      for (const [key, f] of m) {
        const docLen = this.lens.get(key) || this.avgdl;
        const tf = (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1))));
        scores.set(key, (scores.get(key) || 0) + idf * tf * w);
        if (w >= 1.0) {
          matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
        }
      }
    }

    const primaryCount = Array.from(weightedTokens.values()).filter((w) => w >= 1.0).length || 1;

    const out = [];
    for (const [key, score] of scores) {
      const matched = matchCounts.get(key) || 0;
      const coverage = matched / primaryCount;
      out.push({ key, score, coverage });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

// 初始化全局 BM25 倒排索引
const index = new InvertedIndex();
for (const s of SKILLS) {
  const m = s.manifest;
  const md = s.files["SKILL.md"] || "";
  index.add(s.key, [
    { text: m.name, weight: 3.5 },
    { text: (m.triggers || []).join(" "), weight: 3.0 },
    { text: (s.syntheticTriggers || []).join(" "), weight: 1.5 }, // Part A: 合成 triggers 走 1.5 适度权重通道
    { text: (m.keywords || []).join(" "), weight: 2.0 },
    { text: (m.tags || []).join(" "), weight: 2.0 },
    { text: m.description || "", weight: 2.0 },
    { text: m.whenToUse || "", weight: 1.5 },
    { text: md.slice(0, 1200), weight: 0.8 },
  ]);
}

async function handleMcp(msg) {
  if (!msg || typeof msg !== "object") {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }

  const method = msg.method;
  const id = msg.id ?? null;

  if (method === "initialize") {
    const rules = SKILLS.filter((s) => s.manifest.skillType === "rule");
    const rulesSummary = rules.map((r) => "• " + r.key + ": " + (r.manifest.description.split("：")[0] || r.manifest.description.slice(0, 35))).join("\\n");
    const instructions = "Skill-MCP 技能与准则中心。在代码生成与工程任务中，请严格遵守以下全局生效准则：\\n" + rulesSummary + "\\n\\n如需查阅具体执行 SOP，可通过 skill_get 获取其完整规范。";

    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "skill-mcp", version: "1.0.0" },
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false }
        },
        instructions
      }
    };
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }

  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "skill_search",
            description: "按意图语义检索匹配的技能（全局准则已在 initialize 中常驻下发，支持 verbose 调优打分）",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "任务需求描述" },
                topK: { type: "number", description: "返回数量上限 (默认 5)" },
                verbose: { type: "boolean", description: "是否返回打分细节 (BM25词频分/语义向量分分解，用于调试调优，默认 false)" },
                includeRules: { type: "boolean", description: "是否在本次响应中附带全局准则清单 (默认 false，准则已在 initialize 注入)" }
              },
              required: ["query"]
            }
          },
          {
            name: "skill_get",
            description: "获取指定技能的完整 SKILL.md 执行手册与上下文指导",
            inputSchema: {
              type: "object",
              properties: {
                key: { type: "string", description: "技能标识符，如 'dev:naming-conventions'" }
              },
              required: ["key"]
            }
          },
          {
            name: "skill_inspect",
            description: "查看技能元数据、依赖项与文件清单",
            inputSchema: {
              type: "object",
              properties: {
                key: { type: "string", description: "技能标识符" }
              },
              required: ["key"]
            }
          }
        ]
      }
    };
  }

  if (method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};

    if (name === "skill_search") {
      const query = String(args.query || "");
      const topK = Math.min(Math.max(Number(args.topK) || 5, 1), 20);
      const verbose = Boolean(args.verbose);
      const includeRules = Boolean(args.includeRules);

      const qTokens = segment(query);
      if (qTokens.length === 0) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "未找到与该需求匹配的技能（输入均为通用无意义词汇）。" }],
            structuredContent: { count: 0, hits: [] }
          }
        };
      }

      // Part B: 查询同义词扩展
      const weightedTokens = expandQueryTokens(qTokens, query);
      const allSearchTokens = Array.from(weightedTokens.keys());

      const qv = hashVector(allSearchTokens, 2048);
      const qLower = query.toLowerCase();

      // 1. BM25 检索打分
      const bm25Hits = index.search(weightedTokens);
      const bm25Map = new Map();
      const coverageMap = new Map();
      let maxBm25 = 0;
      for (const h of bm25Hits) {
        bm25Map.set(h.key, h.score);
        coverageMap.set(h.key, h.coverage);
        if (h.score > maxBm25) maxBm25 = h.score;
      }

      // ─────────────────────────────────────────────────────────
      // Part C v5: 两阶段打分 —— 拒识与降权解耦（核心手术）
      // 原则：原始分管「是不是域内」，惩罚只管「排第几」，不许共用一个数字。
      // v4 病灶：cov/rule 惩罚掺进总分后再和地板分比较，把有原始词法信号的域内候选
      // （「打分」直击 desc、「命名」直击 name）整体压到地板之下，直接误杀返回空。
      // ─────────────────────────────────────────────────────────
      const residentRuleKeys = new Set(
        SKILLS.filter((s) => s.manifest.skillType === "rule").map((s) => s.key)
      );
      const FLOOR_RAW = 0.35;    // 准入地板：只看原始分。校准依据：域内活体最低分 0.38 过线存活，留 0.03 余量
      const RULE_PENALTY = 0.15; // rule 惩罚：只影响排序，不影响准入（v4 验证该力度下 rule 仍能以 0.45~0.81 过线）

      // 1) 原始层：干净信号打分（全库，包含 rule）
      const scored = SKILLS.map((s) => {
        const isRule = residentRuleKeys.has(s.key);
        const sem = s.vector ? dot(qv, s.vector) : 0;
        const lexRaw = bm25Map.get(s.key) || 0;
        const coverage = coverageMap.get(s.key) || 0;
        const lexNorm = maxBm25 > 0 ? lexRaw / maxBm25 : 0;

        let bonus = 0;
        // 人工 trigger 命中享 0.35 大额 TriggerBonus
        if (s.manifest.triggers?.some((t) => qLower.includes(t.toLowerCase()) || t.toLowerCase().includes(qLower))) {
          bonus += 0.35;
        }
        if (s.manifest.name?.toLowerCase().includes(qLower) || qLower.includes(s.manifest.name?.toLowerCase())) {
          bonus += 0.4;
        }

        // 原始分：未掺任何惩罚，唯一准入依据
        const rawFit = (lexNorm * 0.6 + sem * 0.4) + bonus;

        // 域外强力阻断：这是「是不是域内」的判定，属于原始层职责，不是惩罚
        if (bonus === 0 && coverage < 0.25 && sem < 0.25) {
          return {
            skill: s,
            raw: 0,
            score: 0,
            lex: Math.round(lexNorm * 1000) / 1000,
            sem: Math.round(sem * 1000) / 1000,
            cov: coverage,
            covStr: Math.round(coverage * 100) + "%",
            bonus: 0,
            isRule
          };
        }

        // 2) 惩罚层：只影响排序与输出 fit，永不参与准入
        //    cov 惩罚与 v4 的 penalizedLex 数学等价：lexNorm*0.6*(1-min(cov*2,1))，
        //    保证非 rule 候选的排序与 v4 完全一致；rule 改用减法 -0.15。
        const covPenalty = coverage >= 0.3 ? 0 : lexNorm * 0.6 * (1 - Math.min(coverage * 2, 1));
        const finalFit = rawFit - (isRule ? RULE_PENALTY : 0) - covPenalty;

        return {
          skill: s,
          raw: Math.round(rawFit * 1000) / 1000,
          score: Math.round(finalFit * 1000) / 1000,
          lex: Math.round(lexNorm * 1000) / 1000,
          sem: Math.round(sem * 1000) / 1000,
          cov: coverage,
          covStr: Math.round(coverage * 100) + "%",
          bonus,
          isRule
        };
      });

      scored.sort((a, b) => b.score - a.score || b.raw - a.raw);

      // ─────────────────────────────────────────────────────────
      // Part C: 闸 2 & 闸 3 — 平坦度相对 Margin 拒识 + 绝对地板分
      // 全部在【原始分】维度计算：拒识看的是域内证据强度，与惩罚无关。
      // ─────────────────────────────────────────────────────────
      const byRaw = [...scored].sort((a, b) => b.raw - a.raw);
      let validHits = [];
      if (byRaw.length > 0 && byRaw[0].raw > 0) {
        const top1 = byRaw[0].raw;
        const median = byRaw[Math.floor(byRaw.length / 2)].raw;
        const peakMargin = top1 - median;
        const isTriggerHit = byRaw[0].bonus > 0;

        // 闸 2 & 3: 只有当命中 trigger、或具有明显尖峰 (top1>=0.26 且 margin>=0.14)、
        // 或词法证据足够硬 (cov>=0.40 且 lex>=0.50) 时才放行
        const isConfident = (
          isTriggerHit ||
          (top1 >= 0.26 && peakMargin >= 0.14) ||
          (byRaw[0].cov >= 0.40 && byRaw[0].lex >= 0.50)
        );

        if (isConfident) {
          // 准入地板：绝对值 FLOOR_RAW，取代 v4 的相对地板 max(0.25, top1*0.4)
          validHits = scored.filter((s) => s.raw >= FLOOR_RAW);
        }
      }

      const hits = validHits.slice(0, topK).map((h) => {
        const item = {
          key: h.skill.key,
          name: h.skill.manifest.name,
          desc: h.skill.manifest.description,
          fit: h.score
        };
        if (h.isRule) {
          item.resident = true; // 常驻准则：摘要已通过 initialize 下发，如需完整 SOP 可调用 skill_get
        }
        if (verbose) {
          item.fitReasons = ["bm25 " + h.lex, "sem " + h.sem, "cov " + h.covStr, "raw " + h.raw];
        }
        return item;
      });

      // 构建文本摘要
      let summaryText = hits.length > 0
        ? hits.map((h, i) => {
            const fitStr = verbose && h.fitReasons ? h.fit + " [" + h.fitReasons.join(", ") + "]" : h.fit;
            return (i + 1) + ". " + h.key + " (fit: " + fitStr + ") - " + h.desc;
          }).join("\\n")
        : "未找到与该需求匹配的技能（本服务专注于软件工程、架构设计、代码质量、DevOps 与技术推理）。";

      const structured = {
        count: hits.length,
        hits
      };

      if (includeRules) {
        const hitKeys = new Set(hits.map((h) => h.key));
        structured.activeRules = SKILLS.filter((s) => s.manifest.skillType === "rule" && !hitKeys.has(s.key)).map((s) => ({
          key: s.key,
          summary: s.manifest.description.split("：")[0] || s.manifest.description.slice(0, 35)
        }));
        summaryText += "\\n\\n### 全局强制准则 (Active Rules):\\n" + structured.activeRules.map((r) => "- [RULE] " + r.key + ": " + r.summary).join("\\n");
      }

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: summaryText }],
          structuredContent: structured
        }
      };
    }

    if (name === "skill_inspect") {
      const key = String(args.key || "");
      const found = SKILLS.find((s) =>
        s.key === key ||
        s.manifest.name === key ||
        s.key.startsWith(key + "@") ||
        (s.manifest.namespace && (s.manifest.namespace + ":" + s.manifest.name) === key)
      );
      if (!found) {
        return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Skill not found: " + key }] } };
      }

      const inspectData = {
        key: found.key,
        name: found.manifest.name,
        namespace: found.manifest.namespace,
        version: found.manifest.version,
        description: found.manifest.description,
        category: found.manifest.category,
        tags: found.manifest.tags || [],
        capabilities: found.manifest.capabilities || [],
        dependencies: found.manifest.dependencies || [],
        permissions: found.manifest.permissions || {},
        files: Object.keys(found.files),
        skillType: found.manifest.skillType || "tool"
      };

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(inspectData) }],
          structuredContent: inspectData
        }
      };
    }

    if (name === "skill_get") {
      const key = String(args.key || "");
      const found = SKILLS.find((s) =>
        s.key === key ||
        s.manifest.name === key ||
        s.key.startsWith(key + "@") ||
        (s.manifest.namespace && (s.manifest.namespace + ":" + s.manifest.name) === key)
      );
      if (!found) {
        return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Skill not found: " + key }] } };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: found.files["SKILL.md"] || JSON.stringify(found.manifest) }],
          structuredContent: {
            key: found.key,
            files: Object.keys(found.files)
          }
        }
      };
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + name } };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found: " + method } };
}

// 具名导出 segment：仅供 test-tokenizer.mjs 从构建产物做分词一致性验证（Workers 允许 default+具名并存）
export { segment };

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, x-requested-with"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === "POST") {
      try {
        const body = await request.json();
        const res = await handleMcp(body);
        if (res === null) {
          return new Response(null, { status: 202, headers: corsHeaders });
        }
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: " + (err.message || String(err)) }
        }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    if (url.pathname === "/sse" || (request.headers.get("accept") || "").includes("text/event-stream")) {
      const endpointUri = url.origin + "/mcp";
      const sseBody = "event: endpoint\\ndata: " + endpointUri + "\\n\\n";
      return new Response(sseBody, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...corsHeaders
        }
      });
    }

    if (url.pathname === "/health" || url.pathname === "/info") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "Skill-MCP Edge Gateway",
        skillsCount: SKILLS.length,
        rulesCount: SKILLS.filter(s => s.manifest.skillType === "rule").length,
        version: "1.0.0"
      }, null, 2), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "skill-mcp", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } },
        skillsCount: SKILLS.length,
        rulesCount: SKILLS.filter(s => s.manifest.skillType === "rule").length
      }
    }, null, 2), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
`;

mkdirSync(join(process.cwd(), "dist"), { recursive: true });
writeFileSync(join(process.cwd(), "dist", "esa-worker.js"), workerSource, "utf8");
console.log(`[3/3] 🚀 构建成功！产物已输出到 dist/esa-worker.js (${(Buffer.byteLength(workerSource) / 1024).toFixed(2)} KB)`);
