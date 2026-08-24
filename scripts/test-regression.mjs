// test-regression.mjs —— 黑盒回归 runner:34 发考卷,直接审讯构建产物(或 --remote 打线上)
//
// 用法:
//   node scripts/build-esa.mjs && node scripts/test-regression.mjs            # 本地产物模式(默认)
//   node scripts/test-regression.mjs --remote                                 # 打 meta.endpoint 线上环境
//   node scripts/test-regression.mjs --remote https://other.example.com/mcp   # 指定线上地址
//
// 判定规则对齐 suite.pass_criteria:
//   hit:    topK 内任一 hit 的 key 命中 expect 前缀/子串即过;同时标注是否 top1(严格判定参考)
//   reject: 返回空即过;top1.fit >= reject_floor(0.55) 记为泄漏

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const suitePath = join(__dirname, "..", "tests", "regression-suite.json");
const suite = JSON.parse(readFileSync(suitePath, "utf8"));

const argv = process.argv.slice(2);
const remoteIdx = argv.indexOf("--remote");
const remoteMode = remoteIdx !== -1;
const remoteUrl = remoteMode
  ? (argv[remoteIdx + 1] && !argv[remoteIdx + 1].startsWith("-") ? argv[remoteIdx + 1] : suite.meta.endpoint)
  : "";

const TOP_K = suite.meta.call_args?.topK ?? 3;
const FLOOR = suite.pass_criteria.reject_floor ?? 0.55;

function rpcBody(query, verbose) {
  return JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "skill_search", arguments: { query, topK: TOP_K, verbose } },
  });
}

let callSearch;
if (remoteMode) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const interval = suite.meta.request_interval_ms ?? 250;
  callSearch = async (query, verbose) => {
    const res = await fetch(remoteUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: rpcBody(query, verbose),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    await sleep(interval); // 对线上礼貌一点
    const rpc = await res.json();
    return rpc?.result?.structuredContent ?? { count: 0, hits: [] };
  };
} else {
  const workerModule = await import("../dist/esa-worker.js");
  const worker = workerModule.default;
  if (!worker || typeof worker.fetch !== "function") {
    console.error("❌ dist/esa-worker.js 缺少默认 fetch 导出 —— 先跑 node scripts/build-esa.mjs");
    process.exit(2);
  }
  callSearch = async (query, verbose) => {
    const req = new Request("https://local.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rpcBody(query, verbose),
    });
    const res = await worker.fetch(req, {}, {});
    const rpc = await res.json();
    return rpc?.result?.structuredContent ?? { count: 0, hits: [] };
  };
}

function judgeHit(sc, expects) {
  const hits = sc.hits ?? [];
  let matched = null;
  let top1Match = false;
  for (const h of hits) {
    const e = expects.find((x) => typeof h.key === "string" && h.key.includes(x));
    if (e) {
      matched = h;
      if (h === hits[0]) top1Match = true;
      break;
    }
  }
  return { pass: matched !== null, matched, top1Match, top1: hits[0] ?? null };
}

function judgeReject(sc) {
  const hits = sc.hits ?? [];
  if (hits.length === 0) return { pass: true, leaked: null };
  const top1 = hits[0];
  // pass_criteria: top1 fit < floor 或返回空 -> 通过;反之记泄漏
  return { pass: !(Number(top1.fit ?? 0) >= FLOOR), leaked: Number(top1.fit ?? 0) >= FLOOR ? top1 : null, top1 };
}

const results = [];
console.log(`== skill-mcp 黑盒回归 · ${remoteMode ? "REMOTE " + remoteUrl : "本地构建产物 dist/esa-worker.js"} ==`);
console.log(`   用例 ${suite.cases.length} 条 · topK=${TOP_K} · reject 泄漏线 fit>=${FLOOR}\n`);

for (const c of suite.cases) {
  let sc;
  try {
    sc = await callSearch(c.query, true);
  } catch (e) {
    console.log(`💥 ${c.id} 调用失败: ${e.message} (${c.query})`);
    results.push({ ...c, pass: false, error: e.message });
    continue;
  }
  const hits = sc.hits ?? [];
  const j = c.mode === "hit" ? judgeHit(sc, c.expect) : judgeReject(sc);
  results.push({ ...c, ...j });

  if (c.mode === "hit") {
    if (j.pass) {
      const tag = j.top1Match ? "top1" : `top${hits.indexOf(j.matched) + 1}`;
      console.log(`✅ ${c.id} [${c.category}] "${c.query}" → ${j.matched.key} (fit ${j.matched.fit}, ${tag})`);
    } else {
      const top1Str = j.top1 ? `${j.top1.key}(fit ${j.top1.fit})` : "空";
      console.log(`❌ ${c.id} [${c.category}] "${c.query}" → 未命中期望 ${JSON.stringify(c.expect)};top3=${hits.map((h) => h.key + ":" + h.fit).join(" | ") || "空"} | top1=${top1Str}`);
    }
  } else {
    if (j.pass) {
      const note = hits.length === 0 ? "空" : `top1 fit ${j.top1.fit} < ${FLOOR}`;
      console.log(`✅ ${c.id} [${c.category}] "${c.query}" → 干净拒绝(${note})`);
    } else {
      console.log(`❌ ${c.id} [${c.category}] "${c.query}" → 🚨泄漏! ${j.leaked.key} fit=${j.leaked.fit} ≥ ${FLOOR}`);
    }
  }
}

// ---------- 战报 ----------
const hitCases = results.filter((r) => r.mode === "hit");
const rejCases = results.filter((r) => r.mode === "reject");
const hitPassed = hitCases.filter((r) => r.pass).length;
const rejPassed = rejCases.filter((r) => r.pass).length;

const pc = suite.pass_criteria;
const hitOk = hitPassed >= pc.hit_min;
const rejOk = rejCases.length - rejPassed <= pc.reject_leak_max;

console.log("\n—— 战报 ——");
console.log(`域内命中: ${hitPassed}/${hitCases.length} (通过线 ≥${pc.hit_min}/${pc.hit_total}) ${hitOk ? "✅" : "❌"}`);
console.log(`域外拒绝: ${rejPassed}/${rejCases.length} 零泄漏红线 ${rejOk ? "✅" : "❌"}`);
const fails = results.filter((r) => !r.pass);
if (fails.length > 0) {
  console.log("阵亡名单:");
  for (const f of fails) {
    const reason = f.error ? String(f.error) : (f.mode === "hit" ? "未命中" : "泄漏");
    console.log(`  - ${f.id}(${f.mode}): ${reason}${f.note ? " | " + f.note.slice(0, 40) : ""}`);
  }
}
const overall = hitOk && rejOk ? "PASS ✅" : "FAIL ❌";
console.log(`\n总体判定: ${overall}`);
process.exit(hitOk && rejOk ? 0 : 1);
