// 通用工具：semver、文件、哈希、数学、文本、schema 校验（零依赖）
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonValue, JsonSchemaNode } from "./types.ts";

// ---------- semver ----------
export interface SemVer { major: number; minor: number; patch: number; pre: string }

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(v: string): SemVer | null {
  const m = SEMVER_RE.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || "" };
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === "" && b.pre !== "") return 1;
  if (a.pre !== "" && b.pre === "") return -1;
  return a.pre === b.pre ? 0 : a.pre < b.pre ? -1 : 1;
}

function satisfiesSingle(version: SemVer, c: string): boolean {
  const r = c.trim();
  if (r === "" || r === "*" || r === "x" || r === "latest") return true;
  if (r.startsWith(">=")) { const b = parseSemver(r.slice(2)); return !!b && compareSemver(version, b) >= 0; }
  if (r.startsWith("<=")) { const b = parseSemver(r.slice(2)); return !!b && compareSemver(version, b) <= 0; }
  if (r.startsWith(">")) { const b = parseSemver(r.slice(1)); return !!b && compareSemver(version, b) > 0; }
  if (r.startsWith("<")) { const b = parseSemver(r.slice(1)); return !!b && compareSemver(version, b) < 0; }
  if (r.startsWith("^")) {
    const b = parseSemver(r.slice(1));
    if (!b) return false;
    const upper: SemVer = b.major > 0 ? { major: b.major + 1, minor: 0, patch: 0, pre: "" }
      : b.minor > 0 ? { major: 0, minor: b.minor + 1, patch: 0, pre: "" }
      : { major: 0, minor: 0, patch: b.patch, pre: "" };
    return compareSemver(version, b) >= 0 && compareSemver(version, upper) < 0;
  }
  if (r.startsWith("~")) {
    const b = parseSemver(r.slice(1));
    if (!b) return false;
    const upper: SemVer = { major: b.major, minor: b.minor + 1, patch: 0, pre: "" };
    return compareSemver(version, b) >= 0 && compareSemver(version, upper) < 0;
  }
  if (r.endsWith(".x") || r.endsWith(".*") || r.endsWith(".X")) {
    const parts = r.replace(/[.][xX*]$/, "").split(".");
    if (parts.length === 1) return version.major === Number(parts[0]);
    if (parts.length === 2) return version.major === Number(parts[0]) && version.minor === Number(parts[1]);
    return false;
  }
  const exact = parseSemver(r);
  return !!exact && compareSemver(version, exact) === 0;
}

export function satisfies(version: SemVer, range: string): boolean {
  const r = range.trim();
  if (r.includes(" ") && (r.includes("<") || r.includes(">"))) {
    return r.split(/\s+/).filter(Boolean).every((c) => satisfiesSingle(version, c));
  }
  return satisfiesSingle(version, r);
}

// ---------- 文件 / 哈希 ----------
export function ensureDir(p: string): void { mkdirSync(p, { recursive: true }); }

export function readJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; }
}

export function writeJson(p: string, v: unknown): void {
  ensureDir(dirname(p));
  writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}

export function appendJsonl(p: string, v: unknown): void {
  ensureDir(dirname(p));
  appendFileSync(p, JSON.stringify(v) + "\n", "utf8");
}

export function readJsonl<T>(p: string): T[] {
  if (!existsSync(p)) return [];
  const out: T[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const l = line.trim();
    if (l === "") continue;
    try { out.push(JSON.parse(l) as T); } catch { /* 跳过坏行 */ }
  }
  return out;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function uid(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function nowMs(): number { return Date.now(); }

// ---------- 数学 ----------
export function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function l2norm(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  const da = Math.sqrt(dot(a, a));
  const db = Math.sqrt(dot(b, b));
  if (da === 0 || db === 0) return 0;
  return dot(a, b) / (da * db);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

export function wilsonLower(successes: number, trials: number, z: number = 1.96): number {
  if (trials === 0) return 0;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = p + (z * z) / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return Math.max(0, (center - margin) / denom);
}

// ---------- 文本 ----------
const CJK_RE = /[\u4e00-\u9fff]/;

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out: string[] = [];
  for (const w of words) {
    if (CJK_RE.test(w)) {
      if (w.length === 1) out.push(w);
      else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2)); // CJK 二元组
    } else {
      out.push(w);
      if (w.length > 4) for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3)); // 字符三元组
    }
  }
  return out;
}

export function hashToken(t: string, dim: number): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = (h ^ (h >>> 13)) >>> 0;
  return h % dim;
}

// 零依赖向量：符号哈希词袋（l2 归一），支持中文二元组
export function hashVector(tokens: string[], dim: number = 2048): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const t of tokens) v[hashToken(t, dim)] += 1;
  return l2norm(v);
}

// ---------- schema 校验（最小可用子集） ----------
function jsType(v: JsonValue): string {
  return v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
}

function matchesType(v: JsonValue, t: string): boolean {
  switch (t) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    default: return true;
  }
}

export function validateAgainstSchema(value: JsonValue, schema?: JsonSchemaNode, path: string = "$"): string[] {
  const errors: string[] = [];
  if (!schema) return errors;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(path + ": 期望类型 " + types.join("|") + "，实际 " + jsType(value));
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(path + ": 不在枚举值内");
  }
  if (schema.properties && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as { [k: string]: JsonValue };
    for (const k of Object.keys(schema.properties)) {
      if (k in obj) errors.push(...validateAgainstSchema(obj[k], schema.properties[k], path + "." + k));
    }
    if (schema.required) {
      for (const k of schema.required) if (!(k in obj)) errors.push(path + "." + k + ": 缺失必填字段");
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((it, i) => errors.push(...validateAgainstSchema(it, schema.items, path + "[" + i + "]")));
  }
  return errors;
}
