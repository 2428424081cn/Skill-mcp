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
  // CJK 短语必须 bigram 化，绝不允许整短语 token 进索引/查询两侧
  { input: "正则卡死", mustHave: ["正则", "卡死"], mustNot: ["正则卡死"], note: "bigram 化，不含整短语 token；滑动窗口含中间片「则卡」属设计行为" },
  // 拉丁+数字不拆碎（长度<=4 无 trigram，严格相等）
  { input: "vue3", exact: ["vue3"], note: "拉丁+数字整词保留" },
  // 词边界切分 + lowercase
  { input: "api key", exact: ["api", "key"], note: "按词边界切+lowercase" },
  { input: "npm audit", mustHave: ["npm", "audit"], mustNot: ["npmaudit"], note: "按词边界切+lowercase（audit 长>4 附带三元组召回片，属设计行为）" },
  // 大小写归一（长词附带字符三元组召回片，属设计行为，不做严格相等）
  { input: "TypeScript", mustHave: ["typescript"], mustNot: ["TypeScript"], note: "大小写归一；附带 typ/ype/... 三元组召回片属设计行为" },
];

console.log("== segment() 分词一致性单测（对象：dist/esa-worker.js 构建产物）==");
for (const c of cases) runCase(c);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
