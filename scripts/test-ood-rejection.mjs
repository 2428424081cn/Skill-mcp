// 测试强化版 CJK 二元组 + 停用词过滤 + 覆盖率判定 + 域外拒绝
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CJK_RE = /[\u4e00-\u9fff]/;

const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "么", "怎", "才", "做", "把", "给", "让", "被", "及", "等", "与", "或", "什么", "怎么", "如何", "怎样", "为什么", "推荐", "几个", "几部", "今天", "明天", "需要", "带", "请问", "帮我", "一下", "可以", "怎么做"
]);

export function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    if (CJK_RE.test(w)) {
      if (w.length === 1) {
        if (!STOPWORDS.has(w)) out.push(w);
      } else {
        // 纯二元组，不再生成单字
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

export function hashVector(tokens, dim = 2048) {
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

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

export class InvertedIndex {
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
    if (queryTokens.length === 0) return [];
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

// 域内最小置信度阈值
const MIN_CONFIDENCE_THRESHOLD = 0.35;

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

    // 覆盖率惩罚：如果 BM25 命中的词汇覆盖率太低（比如 10 个词只撞上了 1 个孤立词），大幅惩罚
    const penalizedLex = coverage >= 0.3 ? lexNorm : lexNorm * coverage * 2;

    let totalScore = (penalizedLex * 0.6 + sem * 0.4) + bonus;

    // 域外强力阻断：如果既没有触发词、也没有名称匹配，且词汇覆盖率 < 25% 且语义余弦 < 0.25，彻底归零
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
      cov: Math.round(coverage * 100) + '%'
    };
  });

  const validHits = scored.filter(s => s.score >= MIN_CONFIDENCE_THRESHOLD);
  validHits.sort((a, b) => b.score - a.score);

  return validHits.slice(0, topK);
}

const outOfDomainQueries = [
  "西红柿炒鸡蛋怎么做才好吃",
  "今天北京的天气预报和空气质量",
  "推荐几部经典的悬疑推理电影",
  "办理护照和签证需要带什么证件",
  "量子力学和广义相对论的核心矛盾",
  "如何在家做正宗的意大利肉酱面",
];

const inDomainQueries = [
  "Docker 容器多阶段打包构建优化",
  "MySQL 数据库表结构检查与慢查询分析",
  "React Shadcn UI 下拉菜单组件开发",
  "大模型 Prompt 注入安全防御",
  "Golang context 传递与 goroutine 泄漏",
  "Spring Boot 3 DDD 六边形架构设计",
];

console.log("================================================================================");
console.log("🚫 域外查询测试（必须 100% 全部拒绝，0 命中！）");
console.log("================================================================================");
let oodPass = 0;
for (const q of outOfDomainQueries) {
  const hits = search(q);
  const isRejected = hits.length === 0;
  if (isRejected) oodPass++;
  const status = isRejected ? "✅ 成功拒绝 (0 hits)" : "❌ 误报命中 (" + hits.length + " hits)";
  console.log(`[${status}] "${q}" -> ${hits.map(h => h.key + '(fit:' + h.score + ', cov:' + h.cov + ')').join(', ') || '无匹配技能'}`);
}
console.log(`\n域外拒绝通过率: ${oodPass}/${outOfDomainQueries.length} (${Math.round(oodPass/outOfDomainQueries.length*100)}%)`);

console.log("\n================================================================================");
console.log("🎯 域内查询测试（必须 100% 精准召回，高置信度！）");
console.log("================================================================================");
let inPass = 0;
for (const q of inDomainQueries) {
  const hits = search(q);
  const isHit = hits.length > 0 && hits[0].score >= 0.6;
  if (isHit) inPass++;
  const status = isHit ? "✅ 完美命中" : "❌ 召回不足";
  console.log(`[${status}] "${q}" -> 🥇 ${hits[0]?.key} (fit: ${hits[0]?.score}, cov: ${hits[0]?.cov})`);
}
console.log(`\n域内召回通过率: ${inPass}/${inDomainQueries.length} (${Math.round(inPass/inDomainQueries.length*100)}%)`);
