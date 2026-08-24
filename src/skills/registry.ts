// skill 注册表：目录加载、内容寻址、版本管理、依赖拓扑解析、lockfile
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { SkillManifest, SkillRecord } from "../types.ts";
import { parseSemver, compareSemver, satisfies, sha256, readJson, writeJson, ensureDir } from "../util.ts";
import { normalizeManifest, synthesizeProfile, parseSkillMd, manifestFromSkillMd, validateManifest } from "./manifest.ts";

export interface RegistryOptions { skillsDir: string; dataDir: string }

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export class SkillRegistry {
  private records = new Map<string, SkillRecord>();
  private versions = new Map<string, SkillRecord[]>(); // "ns:name" -> 按版本降序
  private publishers = new Map<string, string>(); // "ns:name" -> 发布者公钥（TOFU 绑定，v3）
  private readonly lockPath: string;
  private readonly publishersPath: string;

  private readonly opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.opts = opts;
    this.lockPath = join(opts.dataDir, "lock.json");
    this.publishersPath = join(opts.dataDir, "publishers.json");
  }

  get size(): number { return this.records.size; }

  load(): { errors: string[] } {
    const errors: string[] = [];
    this.records.clear();
    this.versions.clear();
    const root = this.opts.skillsDir;
    if (!existsSync(root)) {
      errors.push("skills dir not found: " + root);
      return { errors };
    }
    for (const ns of readdirSync(root)) {
      const nsDir = join(root, ns);
      if (!statSync(nsDir).isDirectory()) continue;
      for (const name of readdirSync(nsDir)) {
        const pkgDir = join(nsDir, name);
        if (!statSync(pkgDir).isDirectory()) continue;
        errors.push(...this.loadPackage(ns, name, pkgDir));
      }
    }
    this.publishers = new Map(Object.entries(readJson<Record<string, string>>(this.publishersPath, {})));
    const lock = readJson<{ entries: { key: string; hash: string }[] }>(this.lockPath, { entries: [] });
    for (const e of lock.entries) {
      const rec = this.records.get(e.key);
      if (!rec) errors.push("lock entry missing on disk: " + e.key);
      else if (rec.contentHash !== e.hash) errors.push("lock hash mismatch: " + e.key);
    }
    return { errors };
  }

  private loadPackage(ns: string, name: string, dir: string): string[] {
    const errors: string[] = [];
    const skillJsonPath = join(dir, "skill.json");
    const skillMdPath = join(dir, "SKILL.md");
    let manifest: SkillManifest | null = null;
    if (existsSync(skillJsonPath)) {
      const norm = normalizeManifest(readJson(skillJsonPath, null));
      manifest = norm.manifest;
      errors.push(...norm.errors.map((e) => ns + "/" + name + ": " + e));
    } else if (existsSync(skillMdPath)) {
      const { frontmatter } = parseSkillMd(readFileSync(skillMdPath, "utf8"));
      const made = manifestFromSkillMd(frontmatter, ns, name);
      manifest = made.manifest;
      errors.push(...made.errors.map((e) => ns + "/" + name + ": " + e));
    }
    if (!manifest) {
      errors.push("no skill.json or SKILL.md in " + ns + "/" + name);
      return errors;
    }
    manifest.namespace = ns;
    manifest.name = name;
    const files = this.collectFiles(dir);
    const key = ns + ":" + name + "@" + manifest.version;
    const contentHash = sha256(JSON.stringify(manifest) + "\n" + this.hashFiles(files));
    const record: SkillRecord = {
      key, manifest, contentHash, dir,
      installedAt: statSync(dir).mtimeMs,
      profileText: synthesizeProfile(manifest),
      files,
    };
    if (this.records.has(key)) errors.push("duplicate skill key: " + key);
    this.records.set(key, record);
    const vk = ns + ":" + name;
    const arr = this.versions.get(vk) || [];
    arr.push(record);
    this.versions.set(vk, arr);
    return errors;
  }

  private collectFiles(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (d: string): void => {
      for (const entry of readdirSync(d)) {
        if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
        const p = join(d, entry);
        if (statSync(p).isDirectory()) walk(p);
        else out[relative(dir, p).replace(/\\/g, "/")] = readFileSync(p, "utf8");
      }
    };
    walk(dir);
    return out;
  }

  private hashFiles(files: Record<string, string>): string {
    return Object.keys(files).sort().map((p) => p + "\n" + files[p]).join("\n");
  }

  // ---- 查询 ----
  all(): Map<string, SkillRecord> { return this.records; }
  list(): SkillRecord[] { return [...this.records.values()]; }
  get(key: string): SkillRecord | undefined { return this.records.get(key); }

  latest(ns: string, name: string): SkillRecord | undefined {
    const arr = (this.versions.get(ns + ":" + name) || []).slice().sort((a, b) => {
      const av = parseSemver(a.manifest.version) || { major: 0, minor: 0, patch: 0, pre: "" };
      const bv = parseSemver(b.manifest.version) || { major: 0, minor: 0, patch: 0, pre: "" };
      return compareSemver(bv, av);
    });
    const active = arr.filter((r) => r.manifest.status !== "deprecated");
    return active[0] || arr[0];
  }

  resolveVersion(ns: string, name: string, range: string): SkillRecord | undefined {
    let best: SkillRecord | undefined;
    for (const r of this.versions.get(ns + ":" + name) || []) {
      const v = parseSemver(r.manifest.version);
      if (!v || !satisfies(v, range)) continue;
      if (!best || compareSemver(v, parseSemver(best.manifest.version) || { major: 0, minor: 0, patch: 0, pre: "" }) > 0) best = r;
    }
    return best;
  }

  // 依赖解析：外部依赖递归求解析（bundled/external 在 v1 均走 registry，区别见 DESIGN.md Q5）
  resolveDeps(record: SkillRecord): { resolved: SkillRecord[]; missing: string[]; cycles: string[]; conflicts: string[] } {
    const resolved: SkillRecord[] = [];
    const missing: string[] = [];
    const cycles: string[] = [];
    const conflicts: string[] = [];
    const seen = new Set<string>();
    const stack: string[] = [];

    const visit = (rec: SkillRecord): void => {
      if (seen.has(rec.key)) return;
      if (stack.includes(rec.key)) {
        cycles.push(stack.concat(rec.key).join(" -> "));
        return;
      }
      stack.push(rec.key);
      for (const dep of rec.manifest.dependencies || []) {
        const ns = dep.namespace || rec.manifest.namespace;
        const found = this.resolveVersion(ns, dep.name, dep.versionRange);
        if (!found) { missing.push(ns + ":" + dep.name + "@" + dep.versionRange); continue; }
        visit(found);
      }
      stack.pop();
      if (!seen.has(rec.key)) { seen.add(rec.key); resolved.push(rec); }
    };
    visit(record);

    const capOwner = new Map<string, string>();
    for (const r of resolved) {
      for (const c of r.manifest.capabilities || []) {
        const owner = capOwner.get(c);
        if (owner && owner !== r.key) conflicts.push("capability " + c + " provided by both " + owner + " and " + r.key);
        else capOwner.set(c, r.key);
      }
    }
    return { resolved, missing, cycles, conflicts };
  }

  // 发布者绑定查询（TOFU）：该 skill 首次绑定到的公钥
  publisherFor(ns: string, name: string): string | undefined {
    return this.publishers.get(ns + ":" + name);
  }

  // 规范包哈希预览（与 register 完全相同的算法）：签名验证 / 更新门控在落盘前使用
  preview(manifest: SkillManifest, files: Record<string, string>): { manifest: SkillManifest; hash: string; errors: string[] } {
    const norm = normalizeManifest(manifest);
    if (!norm.manifest) return { manifest: null as unknown as SkillManifest, hash: "", errors: norm.errors };
    const m = norm.manifest;
    const filesOnDisk = { ...files, "skill.json": JSON.stringify(m, null, 2) };
    return { manifest: m, hash: sha256(JSON.stringify(m) + "\n" + this.hashFiles(filesOnDisk)), errors: [] };
  }

  // append-only 注册：同版本同内容幂等；同版本不同内容必须升版本；publisher 不匹配绑定则拒绝
  register(manifest: SkillManifest, files: Record<string, string>, publisher?: string): { key: string; errors: string[] } {
    const norm = normalizeManifest(manifest);
    if (!norm.manifest) return { key: "", errors: norm.errors };
    const m = norm.manifest;
    const ns = m.namespace;
    const name = m.name;
    const bound = this.publishers.get(ns + ":" + name);
    if (bound && publisher && publisher !== bound) {
      return { key: "", errors: [`publisher mismatch for ${ns}:${name}: bound to ${bound.slice(0, 16)}..., got ${publisher.slice(0, 16)}...`] };
    }
    const dir = join(this.opts.skillsDir, ns, name);
    ensureDir(dir);
    writeJson(join(dir, "skill.json"), m);
    for (const [p, content] of Object.entries(files)) {
      const target = join(dir, p);
      ensureDir(join(target, ".."));
      writeFileSync(target, content, "utf8");
    }
    // 内容寻址：以磁盘上收集到的全部文件为准（与 load() 完全一致的算法）
    const filesOnDisk = this.collectFiles(dir);
    const hash = sha256(JSON.stringify(m) + "\n" + this.hashFiles(filesOnDisk));
    const existing = this.resolveVersion(ns, name, m.version);
    if (existing) {
      if (existing.contentHash === hash) return { key: existing.key, errors: [] };
      return { key: "", errors: ["version " + m.version + " already exists with different content; bump the version"] };
    }
    const key = ns + ":" + name + "@" + m.version;
    const record: SkillRecord = {
      key, manifest: m, contentHash: hash, dir,
      installedAt: Date.now(),
      profileText: synthesizeProfile(m),
      files: filesOnDisk,
    };
    this.records.set(key, record);
    const arr = this.versions.get(ns + ":" + name) || [];
    arr.push(record);
    this.versions.set(ns + ":" + name, arr);
    if (publisher && !bound) {
      // TOFU：首次注册绑定发布者公钥（v3 签名验证）
      this.publishers.set(ns + ":" + name, publisher);
      writeJson(this.publishersPath, Object.fromEntries(this.publishers));
    }
    this.writeLockfile();
    return { key, errors: [] };
  }

  writeLockfile(): void {
    ensureDir(this.opts.dataDir);
    writeJson(this.lockPath, { entries: [...this.records.values()].map((r) => ({ key: r.key, hash: r.contentHash })) });
  }
}