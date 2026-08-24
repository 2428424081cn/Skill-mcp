// 纯 ESM 零依赖的 ESA 构建器，保证在任何云端 Node.js 环境（Node 18/20/22/24）100% 一键编译成功
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

console.log("== [ESA Cloud Build] 开始构建 Skill-MCP 边缘分发包 ==");

const skillsDir = join(process.cwd(), "skills");

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

      // 计算 Hash 向量
      const dim = 2048;
      const v = new Array(dim).fill(0);
      const profile = [
        manifest.name,
        manifest.category,
        manifest.description,
        manifest.whenToUse,
        (manifest.triggers || []).join(" "),
        (manifest.tags || []).join(" ")
      ].join(" | ").toLowerCase();

      for (let i = 0; i < profile.length; i++) {
        const code = profile.charCodeAt(i);
        const idx = Math.abs((code * 31 + i * 17) % dim);
        v[idx] += 1;
      }
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm);
      if (norm > 0) { for (let i = 0; i < dim; i++) v[i] /= norm; }

      const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
      const key = (manifest.namespace ? manifest.namespace + ":" : "") + manifest.name + "@" + (manifest.version || "1.0.0");

      skills.push({
        key,
        manifest,
        contentHash: hash,
        installedAt: Date.now(),
        profileText: profile,
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
// 包含 ${skills.length} 个精选技能与全局注入准则，纯内存 0 依赖极速检索

const SKILLS = ${JSON.stringify(skills)};

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

export default {
  async fetch(request, env, ctx) {
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
writeFileSync(join(process.cwd(), "dist", "esa-worker.js"), workerSource, "utf8");
console.log(`[2/2] 🚀 构建成功！产物已输出到 dist/esa-worker.js (${(Buffer.byteLength(workerSource) / 1024).toFixed(2)} KB)`);
