// 纯 ESM 零依赖的 ESA 构建器：支持 CJK 中文二元组分词 + BM25 稀疏检索 + 稠密向量混合检索漏斗
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

console.log("== [ESA Cloud Build] 开始构建 Skill-MCP 边缘分发包 (CJK 混合检索版) ==");

const skillsDir = join(process.cwd(), "skills");

const CJK_RE = /[\u4e00-\u9fff]/;

function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (w.length === 1) out.push(w);
      else {
        for (let i = 0; i < w.length; i++) out.push(w[i]);
        for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); // CJK 二元组
      }
    } else {
      out.push(w);
      if (w.length > 4) for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
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
      const profileParts = [
        manifest.name,
        manifest.namespace || "",
        manifest.category || "",
        manifest.description || "",
        manifest.whenToUse || "",
        (manifest.triggers || []).join(" "),
        (manifest.keywords || []).join(" "),
        (manifest.tags || []).join(" "),
        skillMd.slice(0, 1500)
      ];
      const allTokens = tokenize(profileParts.join(" "));
      const v = hashVector(allTokens, 2048);

      const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
      const key = (manifest.namespace ? manifest.namespace + ":" : "") + manifest.name + "@" + (manifest.version || "1.0.0");

      skills.push({
        key,
        manifest,
        contentHash: hash,
        installedAt: Date.now(),
        profileText: profileParts.join(" | "),
        files,
        vector: v
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
console.log(`[1/2] 成功扫描并打包 ${skills.length} 个 Skill`);

// 2. 生成完全独立的 Worker 运行时脚本
const workerSource = `// Skill-MCP 边缘分发网关 (Aliyun ESA / Edge Functions / Cloudflare Workers)
// 包含 ${skills.length} 个精选技能，内置 CJK 二元组分词 + BM25 字段加权检索 + 2048 维向量混合检索

const SKILLS = ${JSON.stringify(skills)};

const CJK_RE = /[\\u4e00-\\u9fff]/;

function tokenize(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\\u4e00-\\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (w.length === 1) out.push(w);
      else {
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

// 初始化全局 BM25 倒排索引
const index = new InvertedIndex();
for (const s of SKILLS) {
  const m = s.manifest;
  const md = s.files["SKILL.md"] || "";
  index.add(s.key, [
    { text: m.name, weight: 3.5 },
    { text: (m.triggers || []).join(" "), weight: 3.0 },
    { text: (m.keywords || []).join(" "), weight: 2.5 },
    { text: (m.tags || []).join(" "), weight: 2.0 },
    { text: m.description || "", weight: 2.0 },
    { text: m.whenToUse || "", weight: 1.5 },
    { text: md.slice(0, 1500), weight: 0.8 },
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

      const qTokens = tokenize(query);
      const qv = hashVector(qTokens, 2048);
      const qLower = query.toLowerCase();

      // 1. BM25 检索打分
      const bm25Hits = index.search(query);
      const bm25Map = new Map();
      let maxBm25 = 0;
      for (const h of bm25Hits) {
        bm25Map.set(h.key, h.score);
        if (h.score > maxBm25) maxBm25 = h.score;
      }

      // 2. 混合融合打分 (BM25 60% + 向量 40% + 显式触发加权)
      const scored = SKILLS.map((s) => {
        const sem = s.vector ? dot(qv, s.vector) : 0;
        const lexRaw = bm25Map.get(s.key) || 0;
        const lexNorm = maxBm25 > 0 ? lexRaw / maxBm25 : 0;

        let bonus = 0;
        if (s.manifest.triggers?.some((t) => qLower.includes(t.toLowerCase()) || t.toLowerCase().includes(qLower))) {
          bonus += 0.35;
        }
        if (s.manifest.name?.toLowerCase().includes(qLower) || qLower.includes(s.manifest.name?.toLowerCase())) {
          bonus += 0.4;
        }

        const totalScore = (lexNorm * 0.6 + sem * 0.4) + bonus;

        return {
          skill: s,
          score: Math.round(totalScore * 1000) / 1000,
          lex: Math.round(lexNorm * 1000) / 1000,
          sem: Math.round(sem * 1000) / 1000
        };
      });

      scored.sort((a, b) => b.score - a.score);
      const hits = scored.slice(0, topK).map((h) => {
        const item = {
          key: h.skill.key,
          name: h.skill.manifest.name,
          desc: h.skill.manifest.description,
          fit: h.score
        };
        if (verbose) {
          item.fitReasons = ["bm25 " + h.lex, "sem " + h.sem];
        }
        return item;
      });

      // 构建文本摘要
      let summaryText = hits.length > 0
        ? hits.map((h, i) => {
            const fitStr = verbose && h.fitReasons ? h.fit + " [" + h.fitReasons.join(", ") + "]" : h.fit;
            return (i + 1) + ". " + h.key + " (fit: " + fitStr + ") - " + h.desc;
          }).join("\\n")
        : "无匹配技能";

      const structured = {
        count: hits.length,
        hits
      };

      // 如果客户端显式要求附带准则清单
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
console.log(`[2/2] 🚀 构建成功！产物已输出到 dist/esa-worker.js (${(Buffer.byteLength(workerSource) / 1024).toFixed(2)} KB)`);
