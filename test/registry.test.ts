import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillRegistry } from "../src/skills/registry.ts";
import type { SkillManifest } from "../src/types.ts";

function mk(over: Partial<SkillManifest> & { name: string; namespace: string; version: string }): SkillManifest {
  return {
    schemaVersion: 1,
    description: "test skill",
    category: "general",
    tags: [], triggers: [], keywords: [], whenToUse: "", whenNotToUse: "",
    useCases: [], preconditions: {},
    io: { input: { semanticType: "any" }, output: { semanticType: "any" } },
    capabilities: [], consumes: [], dependencies: [],
    permissions: { fsRead: [], fsWrite: [], network: [], tools: [], env: [], maxDurationMs: 1000, maxCostCents: 10, mutating: false },
    entrypoint: { kind: "inline", code: "return { ok: true };" },
    status: "active",
    ...over,
  };
}

test("注册 / 最新版本 / append-only / 幂等", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-mcp-reg-"));
  const reg = new SkillRegistry({ skillsDir: join(root, "skills"), dataDir: join(root, "data") });
  const a1 = mk({ namespace: "ns", name: "a", version: "1.0.0" });
  const r1 = reg.register(a1, { "SKILL.md": "---\nname: a\ndescription: hi\n---\nbody" });
  assert.equal(r1.errors.length, 0);
  assert.ok(r1.key.endsWith("@1.0.0"));

  reg.register(mk({ namespace: "ns", name: "a", version: "1.1.0" }), {});
  assert.equal(reg.latest("ns", "a")?.manifest.version, "1.1.0");
  assert.equal(reg.size, 2);

  // 同版本不同内容 -> 拒绝（append-only）
  const rBad = reg.register(mk({ namespace: "ns", name: "a", version: "1.1.0", description: "changed" }), {});
  assert.ok(rBad.errors.length > 0);
  assert.match(rBad.errors[0], /bump the version/);

  // 幂等重注册
  const a2 = mk({ namespace: "ns", name: "a", version: "1.1.0" });
  const rSame = reg.register(a2, {});
  assert.equal(rSame.errors.length, 0);
  assert.equal(rSame.key, reg.latest("ns", "a")?.key);

  // 校验错误
  const rInvalid = reg.register(mk({ namespace: "ns", name: "bad", version: "not-semver" }), {});
  assert.ok(rInvalid.errors.length > 0);
});

test("依赖解析：版本范围 / 缺失 / 循环 / 能力冲突", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-mcp-dep-"));
  const reg = new SkillRegistry({ skillsDir: join(root, "skills"), dataDir: join(root, "data") });
  reg.register(mk({ namespace: "ns", name: "base", version: "1.2.0" }), {});
  reg.register(mk({
    namespace: "ns", name: "mid", version: "1.0.0",
    dependencies: [{ name: "base", namespace: "ns", versionRange: "^1.0.0", kind: "external" }],
  }), {});
  reg.register(mk({
    namespace: "ns", name: "top", version: "2.0.0",
    dependencies: [{ name: "mid", namespace: "ns", versionRange: "1.x", kind: "external" }],
  }), {});
  const top = reg.latest("ns", "top");
  assert.ok(top);
  const res = reg.resolveDeps(top!);
  assert.equal(res.missing.length, 0);
  assert.equal(res.cycles.length, 0);
  assert.deepEqual(res.resolved.map((r) => r.key).sort(), ["ns:base@1.2.0", "ns:mid@1.0.0", "ns:top@2.0.0"]);

  // 循环依赖
  reg.register(mk({ namespace: "ns", name: "c1", version: "1.0.0", dependencies: [{ name: "c2", namespace: "ns", versionRange: "*", kind: "external" }] }), {});
  reg.register(mk({ namespace: "ns", name: "c2", version: "1.0.0", dependencies: [{ name: "c1", namespace: "ns", versionRange: "*", kind: "external" }] }), {});
  assert.ok(reg.resolveDeps(reg.latest("ns", "c1")!).cycles.length > 0);

  // 缺失依赖
  reg.register(mk({ namespace: "ns", name: "lonely", version: "1.0.0", dependencies: [{ name: "ghost", namespace: "ns", versionRange: "^1.0.0", kind: "external" }] }), {});
  assert.equal(reg.resolveDeps(reg.latest("ns", "lonely")!).missing.length, 1);

  // 能力冲突
  reg.register(mk({ namespace: "ns", name: "p1", version: "1.0.0", capabilities: ["pdf:render"] }), {});
  reg.register(mk({ namespace: "ns", name: "p2", version: "1.0.0", capabilities: ["pdf:render"] }), {});
  reg.register(mk({
    namespace: "ns", name: "both", version: "1.0.0",
    dependencies: [
      { name: "p1", namespace: "ns", versionRange: "*", kind: "external" },
      { name: "p2", namespace: "ns", versionRange: "*", kind: "external" },
    ],
  }), {});
  assert.ok(reg.resolveDeps(reg.latest("ns", "both")!).conflicts.length > 0);
});

test("load() 从目录加载 + lockfile 校验", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-mcp-load-"));
  const skillsDir = join(root, "skills");
  const reg1 = new SkillRegistry({ skillsDir, dataDir: join(root, "data") });
  reg1.register(mk({ namespace: "ns", name: "x", version: "1.0.0" }), { "SKILL.md": "---\nname: x\ndescription: hi\n---\nbody" });
  const reg2 = new SkillRegistry({ skillsDir, dataDir: join(root, "data") });
  const errors = reg2.load().errors;
  assert.deepEqual(errors, []);
  assert.equal(reg2.size, 1);
  assert.equal(reg2.get("ns:x@1.0.0")?.profileText.includes("x"), true);
});
