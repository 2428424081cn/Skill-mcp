// 50 条多场景基准标注集 (30 条域内真实场景 + 20 条域外真实噪音)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CJK_RE = /[\u4e00-\u9fff]/;

const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "么", "怎", "才", "做", "把", "给", "让", "被", "及", "等", "与", "或", "什么", "怎么", "如何", "怎样", "为什么", "推荐", "几个", "几部", "今天", "明天", "需要", "带", "请问", "帮我", "一下", "可以", "怎么做"
]);

function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    if (CJK_RE.test(w)) {
      if (w.length === 1) {
        if (!STOPWORDS.has(w)) out.push(w);
      } else {
        for (let i = 0; i < w.length - 1; i++) {
          const bigram = w.slice(i, i + 2);
          if (!STOPWORDS.has(bigram)) out.push(bigram);
        }
      }
    } else {
      if (!STOPWORDS.has(w)) {
        out.push(w);
        if (w.length > 4) {
          for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
        }
      }
    }
  }
  return out;
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
      const tokens = tokenize(field.text);
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
  search(queryTokens) {
    if (!queryTokens || queryTokens.length === 0) return [];
    const N = this.lens.size;
    const scores = new Map();
    const matchCounts = new Map();
    for (const t of queryTokens) {
      const m = this.postings.get(t);
      if (!m) continue;
      const nq = m.size;
      const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1);
      for (const [key, f] of m) {
        const docLen = this.lens.get(key) || this.avgdl;
        const tf = (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1))));
        scores.set(key, (scores.get(key) || 0) + idf * tf);
        matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
      }
    }
    const out = [];
    for (const [key, score] of scores) {
      const matched = matchCounts.get(key) || 0;
      const coverage = queryTokens.length > 0 ? matched / queryTokens.length : 0;
      out.push({ key, score, coverage });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

const skillsDir = "D:/Project/Skill-mcp/skills";
const skills = [];
const index = new InvertedIndex();

function scan(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some(e => e.name === 'skill.json')) {
    const m = JSON.parse(readFileSync(join(dir, 'skill.json'), 'utf8'));
    const md = existsSync(join(dir, 'SKILL.md')) ? readFileSync(join(dir, 'SKILL.md'), 'utf8') : '';
    const key = (m.namespace ? m.namespace + ':' : '') + m.name + '@' + (m.version || '1.0.0');

    index.add(key, [
      { text: m.name, weight: 3.5 },
      { text: (m.triggers || []).join(' '), weight: 3.0 },
      { text: (m.keywords || []).join(' '), weight: 2.5 },
      { text: (m.tags || []).join(' '), weight: 2.0 },
      { text: m.description || '', weight: 2.0 },
      { text: m.whenToUse || '', weight: 1.5 },
      { text: md.slice(0, 1500), weight: 0.8 },
    ]);

    const allTokens = tokenize([
      m.name, m.namespace, m.category, m.description, m.whenToUse,
      (m.triggers || []).join(' '), (m.keywords || []).join(' '), (m.tags || []).join(' '),
      md.slice(0, 1000)
    ].join(' '));

    skills.push({ key, manifest: m, vector: hashVector(allTokens, 2048) });
    return;
  }
  for (const e of entries) if (e.isDirectory()) scan(join(dir, e.name));
}

scan(skillsDir);

// 核心检索与相对 Margin 判定
function search(query, topK = 3) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const qVector = hashVector(qTokens, 2048);
  const qLower = query.toLowerCase();

  const bm25Hits = index.search(qTokens);
  const bm25Map = new Map();
  const coverageMap = new Map();
  let maxBm25 = 0;
  for (const h of bm25Hits) {
    bm25Map.set(h.key, h.score);
    coverageMap.set(h.key, h.coverage);
    if (h.score > maxBm25) maxBm25 = h.score;
  }

  const scored = skills.map((s) => {
    const sem = s.vector ? dot(qVector, s.vector) : 0;
    const lexRaw = bm25Map.get(s.key) || 0;
    const coverage = coverageMap.get(s.key) || 0;
    const lexNorm = maxBm25 > 0 ? lexRaw / maxBm25 : 0;

    let bonus = 0;
    if (s.manifest.triggers?.some((t) => qLower.includes(t.toLowerCase()) || t.toLowerCase().includes(qLower))) {
      bonus += 0.35;
    }
    if (s.manifest.name?.toLowerCase().includes(qLower) || qLower.includes(s.manifest.name?.toLowerCase())) {
      bonus += 0.4;
    }

    const penalizedLex = coverage >= 0.3 ? lexNorm : lexNorm * coverage * 2;
    let totalScore = (penalizedLex * 0.6 + sem * 0.4) + bonus;

    if (bonus === 0 && coverage < 0.25 && sem < 0.25) {
      totalScore = 0;
    }

    return {
      key: s.key,
      name: s.manifest.name,
      description: s.manifest.description,
      score: Math.round(totalScore * 1000) / 1000,
      lex: Math.round(lexNorm * 1000) / 1000,
      sem: Math.round(sem * 1000) / 1000,
      cov: coverage,
      bonus
    };
  });

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score === 0) return [];

  // 计算分布特征：中位数与 Peak-to-Median Margin
  const median = scored[Math.floor(scored.length / 2)].score;
  const top1 = scored[0].score;
  const peakMargin = top1 - median;

  // 相对分判定准则：
  // 1. 显式命中 trigger 或 name bonus
  // 2. 或 top1 >= 0.26 且具有显著峰值 (peakMargin >= 0.14)
  // 3. 或高覆盖率 BM25 (coverage >= 40%)
  const isConfident = (
    scored[0].bonus > 0 ||
    (top1 >= 0.26 && peakMargin >= 0.14) ||
    (scored[0].cov >= 0.40 && scored[0].lex >= 0.50)
  );

  if (!isConfident) {
    return []; // 域外拒绝
  }

  // 候选项截断
  const validHits = scored.filter(s => s.score >= Math.max(0.25, top1 * 0.4));
  return validHits.slice(0, topK);
}

// ---------------- 50 条多场景基准标注集 ----------------

const benchmarkDataset = [
  // === 30 条域内真实场景 (包含正式术语、口语化、场景表达) ===
  { query: "帮我看看代码里有没有把 token 或者密码写死在文件里", expected: "sec:security-secret-scanner", inDomain: true },
  { query: "检查三方依赖库有没有已知 CVE 漏洞和恶意包", expected: "sec:dependency-vulnerability-audit", inDomain: true },
  { query: "这个方法用来判断用户是否登录，起个什么名字比较好", expected: "dev:naming-conventions", inDomain: true },
  { query: "线上突然 502 报警但是日志很乱完全没头绪，帮我排查定位问题", expected: "reasoning:root-cause-5whys", inDomain: true },
  { query: "在 Redis 和 Memcached 之间纠结怎么选，帮我做个架构技术选型对比", expected: "reasoning:decision-tradeoff-matrix", inDomain: true },
  { query: "用 Shadcn UI 和 Radix 写一个带有无障碍焦点的模态弹窗组件", expected: "frontend:shadcn-ui-radix-architect", inDomain: true },
  { query: "Vue3 组件里解构 store 之后页面数据不刷新了怎么解决", expected: "frontend:vue3-pinia-composition", inDomain: true },
  { query: "React 列表点赞之后怎么做前端乐观更新和自动缓存回滚", expected: "frontend:tanstack-query-patterns", inDomain: true },
  { query: "Tailwind 4 的 @theme 变量配置和容器查询怎么写", expected: "frontend:tailwind-v4-design-system", inDomain: true },
  { query: "Spring Boot 3 DDD 六边形架构的分层和领域实体规范", expected: "backend:spring-boot-clean-architecture", inDomain: true },
  { query: "Golang 并发编程如何安全传递 Context 并防止 goroutine 泄露", expected: "backend:golang-idiomatic-patterns", inDomain: true },
  { query: "NestJS 怎么结合 Prisma 做类型安全的 DTO 参数校验", expected: "backend:nestjs-prisma-drizzle", inDomain: true },
  { query: "GraphQL 接口怎么用 DataLoader 解决子字段 N+1 查询性能问题", expected: "backend:graphql-schema-design", inDomain: true },
  { query: "大模型应用怎么防 Prompt 注入攻击和系统提示词泄露", expected: "ai:llm-prompt-injection-defense", inDomain: true },
  { query: "如何让 LLM 严格返回符合 Zod Schema 的合法 JSON 数据", expected: "ai:structured-output-json-schema", inDomain: true },
  { query: "用 Vitest 给这个登录逻辑写 AAA 模式的单测用例并 Mock 接口", expected: "test:vitest-pytest-unit-testing", inDomain: true },
  { query: "写一个校验邮箱的正则表达式，避免 ReDoS 灾难性回溯", expected: "sec:regex-redos-safe-builder", inDomain: true },
  { query: "把这次从 Redux 迁移到 TanStack Query 的技术决策写成 ADR 记录", expected: "arch:architecture-decision-records", inDomain: true },
  { query: "根据提交信息自动生成语义化版本号和 CHANGELOG 更新日志", expected: "dev:semantic-release-changelog", inDomain: true },
  { query: "Docker 多阶段构建打包优化，把镜像体积减小", expected: "devops:docker-ops-assistant", inDomain: true },
  { query: "编写 GitHub Actions 自动化 CI 流水线跑单测并缓存依赖", expected: "devops:ci-cd-github-actions", inDomain: true },
  { query: "分析当前 git 暂存区的代码变动并写一条规范的 commit message", expected: "dev:git-workflow-pro", inDomain: true },
  { query: "这段 SQL 慢查询全表扫描了，帮我 EXPLAIN 分析并加联合索引", expected: "data:sql-query-optimizer", inDomain: true },
  { query: "查询 SQLite 数据库有哪些表以及表结构的列字段约束", expected: "db:db-schema-inspector", inDomain: true },
  { query: "设计一套符合 RFC 规范的 RESTful API 接口和统一响应格式", expected: "web:restful-api-standard", inDomain: true },
  { query: "TypeScript 代码里全是 any 怎么重构成严格类型和泛型守卫", expected: "dev:typescript-strict-guard", inDomain: true },
  { query: "帮我 Code Review 一下这段代码，挑挑里面的安全漏洞和坏味道", expected: "dev:code-review-guard", inDomain: true },
  { query: "这个模块代码太乱耦合太严重了，帮我按 SOLID 原则重构解耦", expected: "arch:clean-code-solid", inDomain: true },
  { query: "FastAPI 怎么用 Pydantic 构建一个带异步鉴权的用户注册路由", expected: "dev:fastapi-rest-service", inDomain: true },
  { query: "用第一性原理拆解这个系统的底层本质逻辑", expected: "reasoning:first-principles", inDomain: true },

  // === 20 条域外真实噪音 (生活、金融、八卦、烹饪、旅游、物理常识等) ===
  { query: "西红柿炒鸡蛋是先放西红柿还是先放鸡蛋好吃", inDomain: false },
  { query: "今天北京和上海的天气预报与下周降雨概率", inDomain: false },
  { query: "推荐几部豆瓣评分 8.5 以上的经典悬疑烧脑电影", inDomain: false },
  { query: "办去日本的旅游签证需要准备哪些银行流水和资产证明", inDomain: false },
  { query: "量子力学里的薛定谔的猫实验到底证明了什么哲学问题", inDomain: false },
  { query: "A股最近半导体板块大涨背后的宏观流动性原因是什么", inDomain: false },
  { query: "正宗的四川麻婆豆腐和回锅肉怎么做才地道", inDomain: false },
  { query: "感冒发烧 38.5 度可以吃布洛芬还是对乙酰氨基酚", inDomain: false },
  { query: "今年中超联赛各支球队的最新积分榜排名", inDomain: false },
  { query: "红烧肉怎么炖才能肥而不腻软烂入味", inDomain: false },
  { query: "如何快速在两周内减掉 5 斤纯脂肪的科学饮食计划", inDomain: false },
  { query: "讲一个好笑的程序员相亲冷笑话", inDomain: false },
  { query: "成都有哪些适合带女朋友去玩的必打卡景点", inDomain: false },
  { query: "猫咪最近频繁打喷嚏流眼泪是猫鼻支还是普通感冒", inDomain: false },
  { query: "为什么地球的公转轨道是椭圆形而不是正圆形", inDomain: false },
  { query: "怎样才能考过驾照科目二的倒车入库和侧方停车", inDomain: false },
  { query: "二手车过户需要带买卖双方的什么证件去车管所", inDomain: false },
  { query: "冲泡正宗的英式伯爵红茶水温应该控制在多少度", inDomain: false },
  { query: "中国古代唐宋八大家分别指的是哪八位文豪", inDomain: false },
  { query: "怎么给刚出生的金毛小狗幼犬挑选健康的狗粮", inDomain: false },
];

console.log("================================================================================");
console.log("📊 50 条全场景基准自动化回归评估 (Benchmark 50 Suite)");
console.log("================================================================================\n");

const startTime = Date.now();
let inDomainSuccess = 0;
let inDomainTotal = 0;
let oodSuccess = 0;
let oodTotal = 0;

const failures = [];

for (const item of benchmarkDataset) {
  const hits = search(item.query, 1);
  if (item.inDomain) {
    inDomainTotal++;
    const topKey = hits[0]?.key;
    const isCorrect = topKey && topKey.startsWith(item.expected);
    if (isCorrect) {
      inDomainSuccess++;
    } else {
      failures.push({
        type: "域内未命中/误匹配",
        query: item.query,
        expected: item.expected,
        actual: topKey || "无命中(0 hits)",
        score: hits[0]?.score || 0
      });
    }
  } else {
    oodTotal++;
    const isRejected = hits.length === 0;
    if (isRejected) {
      oodSuccess++;
    } else {
      failures.push({
        type: "域外漏网/误报",
        query: item.query,
        expected: "0 hits (拒绝)",
        actual: hits[0]?.key,
        score: hits[0]?.score
      });
    }
  }
}

const elapsedMs = Date.now() - startTime;

console.log(`执行 50 条查询总耗时: ${elapsedMs} ms (平均 ${(elapsedMs/50).toFixed(2)} ms/query)\n`);

console.log("【核心指标汇总】:");
console.log(`  1. 🎯 域内召回与准确率: ${inDomainSuccess}/${inDomainTotal} (${(inDomainSuccess/inDomainTotal*100).toFixed(1)}%)`);
console.log(`  2. 🚫 域外拒绝通过率:   ${oodSuccess}/${oodTotal} (${(oodSuccess/oodTotal*100).toFixed(1)}%)`);
console.log(`  3. 🛡️ 误报率 (False Positive): ${(oodTotal - oodSuccess)}/${oodTotal} (${((oodTotal - oodSuccess)/oodTotal*100).toFixed(1)}%)`);
console.log(`  4. 🏆 总体综合得分 (F1 Score): ${( (2 * (inDomainSuccess/inDomainTotal) * (oodSuccess/oodTotal)) / ((inDomainSuccess/inDomainTotal) + (oodSuccess/oodTotal)) * 100 ).toFixed(1)}%\n`);

if (failures.length > 0) {
  console.log("❌ 失败用例清单:");
  failures.forEach((f, i) => {
    console.log(`  [${i+1}] [${f.type}] "${f.query}"`);
    console.log(`      期望: ${f.expected} | 实际: ${f.actual} (fit: ${f.score})`);
  });
} else {
  console.log("🎉 全部 50 条基准测试用例 100% 满分通过！");
}
