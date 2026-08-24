// skill manifest：校验、归一化、SKILL.md frontmatter 解析、task_profile 合成
import type { PermissionSet, SkillManifest } from "../types.ts";
import { parseSemver } from "../util.ts";

export const DEFAULT_PERMISSIONS: PermissionSet = {
  fsRead: [], fsWrite: [], network: [], tools: [], env: [],
  maxDurationMs: 30000, maxCostCents: 50, mutating: false,
};

export function validateManifest(m: SkillManifest): string[] {
  const errors: string[] = [];
  if (!m || typeof m !== "object") return ["manifest is not an object"];
  if (typeof m.name !== "string" || m.name === "") errors.push("name is required");
  if (typeof m.namespace !== "string" || m.namespace === "") errors.push("namespace is required");
  if (typeof m.version !== "string" || !parseSemver(m.version)) errors.push("version must be semver like 1.2.3");
  if (typeof m.description !== "string" || m.description === "") errors.push("description is required");
  if (typeof m.category !== "string" || m.category === "") errors.push("category is required");
  if (m.entrypoint.kind === "inline" && typeof m.entrypoint.code !== "string") errors.push("inline entrypoint requires code");
  if (m.entrypoint.kind !== "inline" && typeof m.entrypoint.file !== "string") errors.push(m.entrypoint.kind + " entrypoint requires file");
  if (typeof m.io?.input?.semanticType !== "string" || typeof m.io?.output?.semanticType !== "string") {
    errors.push("io.input/output.semanticType required");
  }
  return errors;
}

export function normalizeManifest(raw: unknown): { manifest: SkillManifest | null; errors: string[] } {
  if (!raw || typeof raw !== "object") return { manifest: null, errors: ["manifest is not an object"] };
  const m = raw as Partial<SkillManifest>;
  const inputSchema = m.io?.input?.schema;
  const outputSchema = m.io?.output?.schema;
  const manifest: SkillManifest = {
    schemaVersion: 1,
    name: String(m.name || ""),
    namespace: String(m.namespace || ""),
    version: String(m.version || ""),
    description: String(m.description || ""),
    category: String(m.category || "general"),
    tags: m.tags || [],
    triggers: m.triggers || [],
    keywords: m.keywords || [],
    whenToUse: String(m.whenToUse || ""),
    whenNotToUse: String(m.whenNotToUse || ""),
    useCases: m.useCases || [],
    preconditions: m.preconditions || {},
    io: {
      input: { semanticType: String(m.io?.input?.semanticType || "any"), ...(inputSchema ? { schema: inputSchema } : {}) },
      output: { semanticType: String(m.io?.output?.semanticType || "any"), ...(outputSchema ? { schema: outputSchema } : {}) },
    },
    capabilities: m.capabilities || [],
    consumes: m.consumes || [],
    dependencies: m.dependencies || [],
    permissions: { ...DEFAULT_PERMISSIONS, ...(m.permissions || {}) },
    entrypoint: m.entrypoint || { kind: "inline", code: "return null;" },
    examples: m.examples,
    skillType: m.skillType,
    status: m.status || "active",
    author: m.author,
    license: m.license,
  };
  const errors = validateManifest(manifest);
  return { manifest: errors.length ? null : manifest, errors };
}

// embedding 目标：合成的 task profile（见 DESIGN.md Q1）
export function synthesizeProfile(m: SkillManifest): string {
  const parts = [
    m.name, m.category, m.description, m.whenToUse,
    (m.useCases || []).map((u) => u.task + (u.steps ? " " + u.steps : "")).join(" "),
    (m.triggers || []).join(" "), (m.keywords || []).join(" "), (m.tags || []).join(" "),
    "input:" + m.io.input.semanticType, "output:" + m.io.output.semanticType,
    (m.capabilities || []).join(" "),
  ];
  return parts.filter((s) => s && s !== "").join(" | ");
}

// 轻量 YAML frontmatter 子集：key: value 与 "- item" 列表
export function parseSkillMd(content: string): { frontmatter: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { frontmatter: fm, body: content };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end < 0) return { frontmatter: fm, body: content };
  let currentKey = "";
  const listItems: string[] = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (line.startsWith(" ") || line.startsWith("\t") || trimmed.startsWith("-")) {
      if (currentKey) listItems.push(trimmed.replace(/^-+\s*/, ""));
      continue;
    }
    if (currentKey && listItems.length) { fm[currentKey] = listItems.join(","); listItems.length = 0; }
    const idx = line.indexOf(":");
    if (idx > 0) {
      currentKey = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fm[currentKey] = value;
    }
  }
  if (currentKey && listItems.length) fm[currentKey] = listItems.join(",");
  return { frontmatter: fm, body: lines.slice(end + 1).join("\n") };
}

// SKILL.md（Anthropic 风格）-> 最小 manifest：安全默认，无网络、无写
export function manifestFromSkillMd(fm: Record<string, string>, fallbackNs = "", fallbackName = ""): { manifest: SkillManifest | null; errors: string[] } {
  const name = String(fm.name || fallbackName);
  const description = String(fm.description || "");
  const errors: string[] = [];
  if (!name) errors.push("SKILL.md frontmatter missing name");
  if (!description) errors.push("SKILL.md frontmatter missing description");
  const allowedTools = String(fm["allowed-tools"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const norm = normalizeManifest({
    name,
    namespace: String(fm.namespace || fallbackNs), // registry 会覆盖为目录名
    version: String(fm.version || "0.1.0"),
    description,
    category: String(fm.category || "general"),
    tags: String(fm.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
    triggers: String(fm.triggers || "").split(",").map((s) => s.trim()).filter(Boolean),
    whenToUse: description,
    preconditions: allowedTools.length ? { tools: allowedTools } : {},
    io: { input: { semanticType: "any" }, output: { semanticType: "any" } },
    entrypoint: { kind: "inline", code: "return { note: 'SKILL.md only skill; follow the body instructions.' };" },
    license: fm.license,
    author: fm.author,
  });
  return { manifest: norm.manifest, errors: [...errors, ...norm.errors] };
}
