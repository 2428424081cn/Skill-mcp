// 构建适用于 阿里云 ESA / Cloudflare Workers 的单一边缘函数 Bundle
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SkillRegistry } from "../src/skills/registry.ts";
import { HashEmbedder } from "../src/retrieval/embeddings.ts";
import { buildIndex } from "../src/retrieval/indexer.ts";

console.log("== 开始构建 Skill-MCP 边缘分发版本 (ESA / Edge Function) ==");

const skillsDir = join(process.cwd(), "skills");
const dataDir = join(process.cwd(), "data");

// 1. 加载本地全部 73 个 Skill 并计算向量与索引
const registry = new SkillRegistry({ skillsDir, dataDir });
registry.load();
const skills = registry.list();
console.log(`[1/3] 成功加载 ${skills.length} 个 Skill`);

const embedder = new HashEmbedder(2048);
const bundle = await buildIndex(skills, embedder);
console.log(`[2/3] 成功生成内存索引与向量缓存 (Size: ${bundle.index.size})`);

// 2. 导出所有 Skill 数据包为静态 JSON
const packedSkills = skills.map((s) => ({
  key: s.key,
  manifest: s.manifest,
  contentHash: s.contentHash,
  installedAt: s.installedAt,
  profileText: s.profileText,
  files: s.files,
  vector: s.vector,
}));

// 3. 生成独立的 ESA Edge Worker 代码
const workerSource = `// Skill-MCP 边缘分发网关 (Aliyun ESA / Edge Functions / Cloudflare Workers)
// 包含 73 个精选技能与 13 套全局注入准则，纯内存 0 依赖极速检索

const SKILLS = ${JSON.stringify(packedSkills)};

// 轻量 Hash 向量嵌入算法
class EdgeHashEmbedder {
  constructor(dim = 2048) { this.dim = dim; }
  embed(texts) {
    return Promise.resolve(texts.map((t) => {
      const v = new Array(this.dim).fill(0);
      const s = String(t || "").toLowerCase();
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        const idx = Math.abs((code * 31 + i * 17) % this.dim);
        v[idx] += 1;
      }
      let norm = 0;
      for (let i = 0; i < this.dim; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm);
      if (norm > 0) { for (let i = 0; i < this.dim; i++) v[i] /= norm; }
      return v;
    }));
  }
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

const embedder = new EdgeHashEmbedder(2048);

// 核心 MCP 处理逻辑
async function handleMcp(msg) {
  const method = msg.method;
  const id = msg.id;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "skill-mcp-edge", version: "1.0.0" },
        capabilities: { tools: { listChanged: false } }
      }
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "skill_search",
            description: "按意图语义检索技能，并自动注入全局生效的认知与工程准则 (activeRules)",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "任务需求描述" },
                topK: { type: "number", description: "返回数量上限 (默认 5)" }
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
      const qv = (await embedder.embed([query]))[0];

      // 1. 向量余弦相似度打分
      const scored = SKILLS.map((s) => {
        const sim = s.vector ? dot(qv, s.vector) : 0;
        let bonus = 0;
        const ql = query.toLowerCase();
        if (s.manifest.triggers?.some((t) => ql.includes(t.toLowerCase()))) bonus += 0.2;
        if (s.manifest.name?.toLowerCase().includes(ql)) bonus += 0.3;
        return { skill: s, score: Math.round((sim + bonus) * 1000) / 1000 };
      });

      scored.sort((a, b) => b.score - a.score);
      const hits = scored.slice(0, topK).map((h) => ({
        key: h.skill.key,
        name: h.skill.manifest.name,
        namespace: h.skill.manifest.namespace,
        version: h.skill.manifest.version,
        description: h.skill.manifest.description,
        category: h.skill.manifest.category,
        fit: h.score,
        skillType: h.skill.manifest.skillType || "tool"
      }));

      // 2. 自动提取所有准则型 Skill (skillType === "rule")
      const hitKeys = new Set(hits.map((h) => h.key));
      const activeRules = SKILLS.filter((s) => s.manifest.skillType === "rule" && !hitKeys.has(s.key)).map((s) => ({
        key: s.key,
        name: s.manifest.name,
        namespace: s.manifest.namespace,
        version: s.manifest.version,
        description: s.manifest.description,
        category: s.manifest.category,
        skillType: "rule"
      }));

      const structured = {
        count: hits.length,
        hits,
        activeRules,
        activeRulesNote: "以下准则型 Skill 在所有代码生成、重构与审查场景中必须无条件遵守。请先通过 skill_get 获取其 SKILL.md 详细规范。"
      };

      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured
        }
      };
    }

    if (name === "skill_get" || name === "skill_inspect") {
      const key = String(args.key || "");
      const found = SKILLS.find((s) => s.key === key || s.manifest.name === key);
      if (!found) {
        return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Skill not found: " + key }] } };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: found.files["SKILL.md"] || JSON.stringify(found.manifest, null, 2) }],
          structuredContent: {
            key: found.key,
            manifest: found.manifest,
            skillMd: found.files["SKILL.md"],
            files: Object.keys(found.files)
          }
        }
      };
    }

    return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
  }

  return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
}

// 标准 Web Fetch 处理器 (适配 Aliyun ESA / Cloudflare Workers / Pages)
export default {
  async fetch(request, env, ctx) {
    // 跨域 CORS 支持
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    const url = new URL(request.url);

    // 状态与健康探针
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        service: "Skill-MCP Edge Gateway",
        skillsCount: SKILLS.length,
        rulesCount: SKILLS.filter(s => s.manifest.skillType === "rule").length,
        version: "1.0.0"
      }, null, 2), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // MCP 协议入口
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      try {
        const body = await request.json();
        const res = await handleMcp(body);
        return new Response(JSON.stringify(res), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error: " + (err.message || String(err)) }
        }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};
`;

mkdirSync(join(process.cwd(), "dist"), { recursive: true });
const outPath = join(process.cwd(), "dist", "esa-worker.js");
writeFileSync(outPath, workerSource, "utf8");

console.log(`[3/3] 🚀 ESA 边缘函数 Bundle 生成完毕: dist/esa-worker.js`);
console.log(`文件大小: ${(Buffer.byteLength(workerSource) / 1024).toFixed(2)} KB`);
console.log("== 可以直接上传或粘贴到 阿里云 ESA / Cloudflare Workers 控制台！ ==");
