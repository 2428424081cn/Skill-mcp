// 测试全新的 CJK 双语 BM25 + 稠密向量混合检索算法
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const CJK_RE = /[\u4e00-\u9fff]/;

export function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (w.length === 1) out.push(w);
      else {
        // 单字 + 二元组
        for (let i = 0; i < w.length; i++) out.push(w[i]);
        for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
      }
    } else {
      out.push(w);
      if (w.length > 4) for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
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

// 内存版 BM25
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

  search(query) {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const N = this.lens.size;
    const scores = new Map();

    for (const t of tokens) {
      const m = this.postings.get(t);
      if (!m) continue;
      const nq = m.size;
      const idf = Math.log((N - nq + 0.5) / (nq + 0.5) + 1);
      for (const [key, f] of m) {
        const docLen = this.lens.get(key) || this.avgdl;
        const tf = (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (docLen / (this.avgdl || 1))));
        scores.set(key, (scores.get(key) || 0) + idf * tf);
      }
    }

    const out = [];
    for (const [key, score] of scores) out.push({ key, score });
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

// 加载全部 73 个技能
const skillsDir = "D:/Project/Skill-mcp/skills";
const skills = [];
const index = new InvertedIndex();

function scan(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some(e => e.name === 'skill.json')) {
    const m = JSON.parse(readFileSync(join(dir, 'skill.json'), 'utf8'));
    const md = existsSync(join(dir, 'SKILL.md')) ? readFileSync(join(dir, 'SKILL.md'), 'utf8') : '';
    const key = (m.namespace ? m.namespace + ':' : '') + m.name + '@' + (m.version || '1.0.0');

    // 字段加权 BM25 索引
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

    skills.push({
      key,
      manifest: m,
      vector: hashVector(allTokens, 2048)
    });
    return;
  }
  for (const e of entries) if (e.isDirectory()) scan(join(dir, e.name));
}

scan(skillsDir);
console.log('Loaded skills:', skills.length);

function hybridSearch(query, topK = 5) {
  const qTokens = tokenize(query);
  const qVector = hashVector(qTokens, 2048);
  const qLower = query.toLowerCase();

  // 1. BM25
  const bm25Hits = index.search(query);
  const bm25Map = new Map();
  let maxBm25 = 0;
  for (const h of bm25Hits) {
    bm25Map.set(h.key, h.score);
    if (h.score > maxBm25) maxBm25 = h.score;
  }

  // 2. 向量 + 关键词奖励
  const scored = skills.map((s) => {
    const sem = dot(qVector, s.vector);
    const lexRaw = bm25Map.get(s.key) || 0;
    const lexNorm = maxBm25 > 0 ? lexRaw / maxBm25 : 0;

    let bonus = 0;
    // 触发词命中加权
    if (s.manifest.triggers?.some((t) => qLower.includes(t.toLowerCase()) || t.toLowerCase().includes(qLower))) {
      bonus += 0.35;
    }
    // 技能名称直接命中
    if (s.manifest.name?.toLowerCase().includes(qLower) || qLower.includes(s.manifest.name?.toLowerCase())) {
      bonus += 0.4;
    }

    // 混合打分公式 (BM25 占 60%，向量占 40% + 显式匹配奖励)
    const totalScore = (lexNorm * 0.6 + sem * 0.4) + bonus;

    return {
      key: s.key,
      name: s.manifest.name,
      description: s.manifest.description,
      score: Math.round(totalScore * 1000) / 1000,
      lex: Math.round(lexNorm * 1000) / 1000,
      sem: Math.round(sem * 1000) / 1000,
      bonus
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

console.log('\n============================================================');
console.log('测试 1: 依赖漏洞 安全检查');
console.log('============================================================');
const r1 = hybridSearch('依赖漏洞 安全检查', 3);
r1.forEach((h, i) => console.log(`  ${i + 1}. ${h.key} (fit: ${h.score}) [BM25: ${h.lex}, Sem: ${h.sem}, Bonus: ${h.bonus}] -> ${h.description.slice(0, 45)}...`));

console.log('\n============================================================');
console.log('测试 2: CVE 漏洞扫描 供应链安全');
console.log('============================================================');
const r2 = hybridSearch('CVE 漏洞扫描 供应链安全', 3);
r2.forEach((h, i) => console.log(`  ${i + 1}. ${h.key} (fit: ${h.score}) [BM25: ${h.lex}, Sem: ${h.sem}, Bonus: ${h.bonus}] -> ${h.description.slice(0, 45)}...`));
