// test-tokenizer.mjs —— 修 3 的「第一步：先确认」单测（部署前本地跑）
//
// 验证对象不是源码副本，而是【构建产物】dist/esa-worker.js 里真实运行的那个 segment()
// （build-esa.mjs 已具名导出），保证「测的就是部署的」。
// 索引侧与查询侧共用同一函数实例 —— 分词对称性由构造保证。
//
// 用法：node scripts/build-esa.mjs && node scripts/test-tokenizer.mjs

import { segment } from "../dist/esa-worker.js";

let pass = 0;
let fail = 0;

function report(ok, input, note) {
  if (ok) pass++;
  else fail++;
  console.log((ok ? "✅" : "❌"), JSON.stringify(input), "->", note);
}

function runCase({ input, exact, mustHave = [], mustNot = [], note }) {
  let got;
  try {
    got = segment(input);
  } catch (e) {
    report(false, input, "segment() 抛错: " + e.message);
    return;
  }
  const shown = JSON.stringify(got);

  if (exact) {
    // 严格相等：token 序列必须完全一致
    const ok = Array.isArray(got)
      && got.length === exact.length
      && exact.every((t, i) => got[i] === t);
    report(ok, input, ok ? shown + ` (== ${JSON.stringify(exact)})` : `${shown} != 期望 ${JSON.stringify(exact)} [${note}]`);
    return;
  }

  // 属性断言：关键 token 必须在场，整短语/大写等必须缺席
  const missing = mustHave.filter((t) => !got.includes(t));
  const leaked = mustNot.filter((t) => got.includes(t));
  const ok = missing.length === 0 && leaked.length === 0;
  report(
    ok,
    input,
    ok
      ? `${shown} [${note}]`
      : `${shown} 缺失:${JSON.stringify(missing)} 泄漏:${JSON.stringify(leaked)} [${note}]`,
  );
}

const cases = [
  // ── v5 基线回归：纯中文 trigger bigram 化，绝不允许整短语 token ──
  { input: "正则卡死", mustHave: ["正则", "卡死"], mustNot: ["正则卡死"], note: "bigram 化，不含整短语 token；滑动窗口含中间片「则卡」属设计行为" },
  { input: "根因分析", mustHave: ["根因", "分析"], note: "刀1 防误伤回归：健康 trigger 的 bigram 全保留" },
  // ── 拉丁与词边界 ──
  { input: "vue3", exact: ["vue3"], note: "拉丁+数字整词保留" },
  { input: "api key", exact: ["api", "key"], note: "按词边界切+lowercase" },
  { input: "npm audit", mustHave: ["npm", "audit"], mustNot: ["npmaudit"], note: "按词边界切+lowercase（audit 长>4 附带三元组召回片，属设计行为）" },
  { input: "TypeScript", mustHave: ["typescript"], mustNot: ["TypeScript"], note: "大小写归一；附带 typ/ype/... 三元组召回片属设计行为" },
  // ── v6 刀2：CJK↔拉丁边界必切，两侧同一套逻辑 ──
  { input: "找bug", mustHave: ["找", "bug"], mustNot: ["找b", "找bug"], note: "混合 token 归一：永远拆成 CJK+拉丁，索引/查询两侧永不错位" },
  // ── v6 刀1：填充 bigram 过滤，长句覆盖率分母只剩内容词 ──
  { input: "这个正则一跑网站就卡死", mustHave: ["正则", "网站", "卡死"], mustNot: ["这个", "个正", "则一", "一跑", "站就", "就卡"], note: "含停用单字的跨字噪声片全部剔除；「跑网」两字均非停用字故保留（无词典不判语义）" },
  // ── v7 终局一刀：单字符拉丁 token 直接丢弃（垃圾匹配源清除）──
  { input: "A股", mustHave: ["股"], mustNot: ["a"], note: "混合词切出的单字符拉丁「a」不入集，杜绝与孤立英文字母的垃圾 BM25 满分" },
  { input: "A/B 测试", mustHave: ["测试"], mustNot: ["a", "b"], note: "孤立字母 a/b 双双丢弃，只剩内容词" }
];

console.log("== segment() 分词一致性单测（对象：dist/esa-worker.js 构建产物）==");
for (const c of cases) runCase(c);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
