// v3 测试：Ed25519 签名验证 / 发布者 TOFU 绑定 / L4 更新门 / recipe shadow 全自动 / 联邦 catalog 导入
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalCatalogPayload, generateSigningKeyPair, signHash, verifyHash } from "../src/security/signing.ts";
import { SkillRegistry } from "../src/skills/registry.ts";
import { RecipeStore } from "../src/eval/recipes.ts";
import { createSkillMcp } from "../src/server.ts";
import type { InvocationLog, SkillManifest } from "../src/types.ts";

function mk(over: Partial<SkillManifest> & { name: string; namespace: string; version: string }): SkillManifest {
  return {
    schemaVersion: 1, description: "v3 test skill", category: "general",
    tags: ["test"], triggers: [], keywords: [], whenToUse: "", whenNotToUse: "",
    useCases: [], preconditions: {},
    io: { input: { semanticType: "text" }, output: { semanticType: "text" } },
    capabilities: ["v3:cap"], consumes: [], dependencies: [],
    permissions: { fsRead: [], fsWrite: [], network: [], tools: [], env: [], maxDurationMs: 1000, maxCostCents: 10, mutating: false },
    entrypoint: { kind: "inline", code: "return { ok: true };" },
    status: "active",
    ...over,
  };
}

function tmp(): { root: string; skills: string; data: string } {
  const root = mkdtempSync(join(tmpdir(), "skill-mcp-v3-"));
  const skills = join(root, "skills");
  const data = join(root, "data");
  return { root, skills, data };
}

async function call(server: Awaited<ReturnType<typeof createSkillMcp>>["server"], name: string, args: Record<string, unknown> = {}): Promise<{ isError?: boolean; text: string; sc: Record<string, any> }> {
  const res = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as { result?: { isError?: boolean; content?: { text?: string }[]; structuredContent?: Record<string, any> } };
  const r = res.result!;
  return { isError: r.isError, text: r.content?.[0]?.text ?? "", sc: (r.structuredContent ?? {}) as Record<string, any> };
}

// ---------- 签名 ----------

test("signing: roundtrip, tamper rejection, bad key rejection", () => {
  const { publicKey, privateKey } = generateSigningKeyPair();
  const hash = "abc123def456";
  const sig = signHash(privateKey, hash);
  assert.ok(verifyHash(publicKey, hash, sig), "合法签名通过");
  assert.ok(!verifyHash(publicKey, "tampered-hash", sig), "内容被篡改 -> 拒绝");
  const other = generateSigningKeyPair();
  assert.ok(!verifyHash(other.publicKey, hash, sig), "错误的公钥 -> 拒绝");
  assert.ok(!verifyHash("not-base64!!", hash, sig), "非法公钥 -> 拒绝");
});

// ---------- 发布者绑定（TOFU） ----------

test("registry: publisher binding enforces continuity", () => {
  const t = tmp();
  try {
    const reg = new SkillRegistry({ skillsDir: t.skills, dataDir: t.data });
    const r1 = reg.register(mk({ namespace: "ns", name: "a", version: "1.0.0" }), {}, "pub-A");
    assert.equal(r1.errors.length, 0);
    assert.equal(reg.publisherFor("ns", "a"), "pub-A");
    const r2 = reg.register(mk({ namespace: "ns", name: "a", version: "1.1.0" }), {}, "pub-B");
    assert.ok(r2.errors.length > 0, "不同发布者升版被拒");
    assert.match(r2.errors[0], /publisher mismatch/);
    const r3 = reg.register(mk({ namespace: "ns", name: "a", version: "1.1.0" }), {}, "pub-A");
    assert.equal(r3.errors.length, 0, "同一发布者升版通过");
    const m3 = mk({ namespace: "ns", name: "a", version: "1.2.0" });
    const pv = reg.preview(m3, {});
    assert.ok(pv.hash.length === 64);
  } finally { rmSync(t.root, { recursive: true, force: true }); }
});

// ---------- 信任模式（enforce） ----------

test("trust enforce: unsigned rejected, anchor-signed accepted, wrong key rejected", async () => {
  const t = tmp();
  const { publicKey, privateKey } = generateSigningKeyPair();
  const { server, ctx } = await createSkillMcp({ skillsDir: t.skills, dataDir: t.data, trust: { mode: "enforce", keys: [publicKey] } });
  try {
    const m = mk({ namespace: "ns", name: "x", version: "1.0.0" });
    const reg = new SkillRegistry({ skillsDir: t.skills, dataDir: t.data });
    const pv = reg.preview(m, {});

    const unsigned = await call(server, "skill_register", { manifest: m, files: {} });
    assert.ok(unsigned.isError, "无签名被拒");
    assert.match(unsigned.text, /publisher key not in trust anchors/);

    const badKey = generateSigningKeyPair();
    const bad = await call(server, "skill_register", { manifest: m, files: {}, publisherKey: badKey.publicKey, signature: signHash(badKey.privateKey, pv.hash) });
    assert.ok(bad.isError, "非锚点公钥被拒");

    const good = await call(server, "skill_register", { manifest: m, files: {}, publisherKey: publicKey, signature: signHash(privateKey, pv.hash) });
    assert.ok(!good.isError, "锚点签名通过");
    assert.equal(good.sc.verified, true);
    assert.ok(good.sc.publisher);
  } finally {
    ctx.telemetry.close();
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("trust enforce: TOFU binding rejects later publisher swap", async () => {
  const t = tmp();
  const { server, ctx } = await createSkillMcp({ skillsDir: t.skills, dataDir: t.data, trust: { mode: "enforce" } });
  try {
    const reg = new SkillRegistry({ skillsDir: t.skills, dataDir: t.data });
    const alice = generateSigningKeyPair();
    const bob = generateSigningKeyPair();
    const m1 = mk({ namespace: "ns", name: "y", version: "1.0.0" });
    const h1 = reg.preview(m1, {}).hash;
    const ok1 = await call(server, "skill_register", { manifest: m1, files: {}, publisherKey: alice.publicKey, signature: signHash(alice.privateKey, h1) });
    assert.ok(!ok1.isError, "TOFU 首注绑定 Alice");

    const m2 = mk({ namespace: "ns", name: "y", version: "1.1.0" });
    const h2 = reg.preview(m2, {}).hash;
    const swap = await call(server, "skill_register", { manifest: m2, files: {}, publisherKey: bob.publicKey, signature: signHash(bob.privateKey, h2) });
    assert.ok(swap.isError, "Bob 不能给 Alice 的 skill 升版");
    const cont = await call(server, "skill_register", { manifest: m2, files: {}, publisherKey: alice.publicKey, signature: signHash(alice.privateKey, h2) });
    assert.ok(!cont.isError, "Alice 继续升版通过");
  } finally {
    ctx.telemetry.close();
    rmSync(t.root, { recursive: true, force: true });
  }
});

// ---------- L4 更新门 ----------

test("gate testsRequired: bump needs passing tests", async () => {
  const t = tmp();
  const { server, ctx } = await createSkillMcp({ skillsDir: t.skills, dataDir: t.data, gate: { testsRequired: true } });
  try {
    const v1 = mk({ namespace: "ns", name: "g", version: "1.0.0" });
    const first = await call(server, "skill_register", { manifest: v1, files: {} });
    assert.ok(!first.isError, "新 skill 首版不需要 tests");

    const v2 = mk({ namespace: "ns", name: "g", version: "1.1.0" });
    const noTests = await call(server, "skill_register", { manifest: v2, files: {} });
    assert.ok(noTests.isError, "升版无 tests 被拒");
    assert.match(noTests.text, /requires tests/);

    const v2WithTests = mk({ namespace: "ns", name: "g", version: "1.1.0", tests: { entry: "tests/run.mjs" } });
    const passed = await call(server, "skill_register", { manifest: v2WithTests, files: { "tests/run.mjs": "process.exit(0);\n" } });
    assert.ok(!passed.isError, "tests 通过 -> 升版成功");
    assert.match(passed.sc.tests, /passed/);

    const v3 = mk({ namespace: "ns", name: "g", version: "1.2.0", tests: { entry: "tests/run.mjs" } });
    const failed = await call(server, "skill_register", { manifest: v3, files: { "tests/run.mjs": "process.exit(1);\n" } });
    assert.ok(failed.isError, "tests 失败 -> 升版被拒");
    assert.match(failed.text, /tests failed/);
  } finally {
    ctx.telemetry.close();
    rmSync(t.root, { recursive: true, force: true });
  }
});

test("HITL grant token returned and reusable within TTL", async () => {
  const t = tmp();
  const { server, ctx } = await createSkillMcp({ skillsDir: t.skills, dataDir: t.data });
  try {
    // 注册一个写权限的 mutating skill
    const m = mk({ namespace: "ns", name: "mut", version: "1.0.0", permissions: {
      fsRead: [], fsWrite: ["workspace"], network: [], tools: [], env: [], maxDurationMs: 1000, maxCostCents: 10, mutating: true,
    } });
    const reg = await call(server, "skill_register", { manifest: m, files: {} });
    assert.ok(!reg.isError);

    const first = await call(server, "skill_run", { skill: "ns:mut", inputs: {} });
    assert.equal(first.sc.requiresApproval, true, "写权限默认 ask");

    const second = await call(server, "skill_run", { skill: "ns:mut", inputs: {}, approveAsks: true });
    assert.ok(!second.isError);
    assert.equal(second.sc.outcome, "success");
    assert.ok(second.sc.grantTokenId, "approve 后返回 grantTokenId");

    const third = await call(server, "skill_run", { skill: "ns:mut", inputs: {}, grantTokenId: second.sc.grantTokenId });
    assert.ok(!third.isError, "grant token 复用不再询问");
    assert.equal(third.sc.requiresApproval, undefined);
    assert.equal(third.sc.outcome, "success");

    const forged = await call(server, "skill_run", { skill: "ns:mut", inputs: {}, grantTokenId: "nonexistent" });
    assert.ok(forged.isError, "伪造的 grantTokenId 被拒");
    assert.equal(forged.text, "error: grant token not found or expired");
  } finally {
    ctx.telemetry.close();
    rmSync(t.root, { recursive: true, force: true });
  }
});

// ---------- recipe shadow 全自动 ----------

function wfLog(key: string, workflowId: string, ts: number, ok: boolean): InvocationLog {
  return { ts, runId: key + "-" + workflowId + "-" + ts, skillKey: key, taskText: "t", cluster: -1, outcome: ok ? "success" : "failure", latencyMs: 1, costCents: 0, workflowId };
}

test("recipe store: shadow -> promoted 自动晋升，stale 自动降级，持久化", () => {
  const t = tmp();
  try {
    const store = new RecipeStore({ path: join(t.data, "recipes.json"), minSupport: 0.05, minConfidence: 0.7, shadowMinSupport: 0.02, shadowMinConfidence: 0.5, staleDays: 30 });
    const now = Date.now();
    // 25 个 workflow 里只有 1 个出现过 A-B 链（且全成功）-> 支持度 1/25=0.04：shadow 级
    const logs: InvocationLog[] = [];
    logs.push(wfLog("A", "w0", now, true));
    logs.push(wfLog("B", "w0", now + 10, true));
    for (let w = 1; w < 25; w++) {
      logs.push(wfLog("X", `w${w}`, now + w * 1000, true));
    }
    const s1 = store.sync(logs);
    assert.equal(s1.promoted.length, 0, "0.04 支持度不够正式");
    assert.ok(s1.shadows.some((r) => r.id === "recipe-A-B"), "A-B 进入 shadow 建议");

    // 再补 20 个全成功的 A-B workflow -> 支持度 21/45，超过阈值，自动晋升
    for (let w = 0; w < 20; w++) {
      const off = 25 * 1000 + w * 1000;
      logs.push(wfLog("A", `p${w}`, now + off, true));
      logs.push(wfLog("B", `p${w}`, now + off + 10, true));
    }
    const s2 = store.sync(logs);
    assert.ok(s2.promoted.some((r) => r.id === "recipe-A-B"), "达阈值自动晋升");
    assert.equal(s2.promotedCount, 1);
    const s3 = store.sync(logs);
    assert.equal(s3.promotedCount, 0, "重复同步不重复晋升");

    // 持久化：新实例直接拿到 promoted
    const store2 = new RecipeStore({ path: join(t.data, "recipes.json") });
    assert.ok(store2.promotedList().some((r) => r.id === "recipe-A-B"));

    // 全部过期（>30 天）-> 自动降级
    const oldLogs = logs.map((l) => ({ ...l, ts: l.ts - 40 * 86_400_000 }));
    const s4 = store.sync(oldLogs);
    assert.equal(s4.promoted.length, 0, "stale recipe 自动降级");
    assert.equal(s4.demotedCount, 1);
  } finally { rmSync(t.root, { recursive: true, force: true }); }
});

// ---------- 联邦 catalog 导入 ----------

test("remotes: signed catalog imported, bad signature rejected", async () => {
  const t = tmp();
  const pub = generateSigningKeyPair();
  const catalogSkills = [{ manifest: mk({ namespace: "fed", name: "hello", version: "1.0.0", description: "联邦市场里的问候技能" }), files: {} }];
  const catalog = { publisher: "marketplace", signature: signHash(pub.privateKey, canonicalCatalogPayload(catalogSkills)), skills: catalogSkills };

  const http = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(catalog));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as { port: number }).port;
  const { server: s1, ctx } = await createSkillMcp({ skillsDir: t.skills, dataDir: join(t.root, "d1"), remotes: [{ name: "market", url: `http://127.0.0.1:${port}/catalog.json`, keys: [pub.publicKey] }] });
  try {
    const search = await call(s1, "skill_search", { query: "问候" });
    const hitKeys = (search.sc.hits ?? []).map((h: { key: string }) => h.key);
    assert.ok(hitKeys.some((k: string) => k.startsWith("fed:hello@")), "联邦 skill 已导入并可检索");
  } finally {
    http.close();
    ctx.telemetry.close();
    rmSync(t.root, { recursive: true, force: true });
  }
});
