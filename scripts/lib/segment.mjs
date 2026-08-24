// 单一分词器（Single Source of Truth）v6 —— 刀1 内容词覆盖 + 刀2 混合 token 归一
// 「索引侧」与「查询侧」必须走同一个 segment()：两侧 token 对得上，召回才对得上。
// 使用方：
//   - scripts/build-esa.mjs   构建时（IDF 合成 triggers、BM25 字段入倒排前）
//   - dist/esa-worker.js      运行时（内嵌本文件镜像副本，函数名同为 segment）
//   - scripts/test-tokenizer.mjs 部署前直接从构建产物导入 segment 做一致性验证
//
// v6 规则（第五轮定位探针确诊的两刀）：
//   刀2 混合 token 归一：CJK 与拉丁/数字边界必切，两侧同一套逻辑
//     "找bug" -> ["找","bug"]（永不错位）; "vue3" -> ["vue3"]（纯拉丁+数字保持整词）
//   刀1 填充成分过滤：含停用单字的跨字噪声 bigram 直接不入集（则一/一跑/站就/是不…），
//     长自然句的覆盖率分母只剩内容词 —— 治「句子越长越像人话越被歧视」的结构性稀释
//     例："这个正则一跑网站就卡死" -> 内容词 正则/网站/卡死（这个/一跑/站就/就卡 全部剔除）

export const CJK_RE = /[\u4e00-\u9fff]/;

export const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "么", "怎", "才", "做", "把", "给", "让", "被", "及", "等", "与", "或", "什么", "怎么", "如何", "怎样", "为什么", "推荐", "几个", "几部", "今天", "明天", "需要", "带", "请问", "帮我", "一下", "可以", "怎么做", "支持", "提供", "使用", "进行", "相关", "问题", "处理", "实现", "工具", "助手", "功能", "基于", "用于",
  // v6 刀1 补充（第五轮探针实证的高频填充成分）
  "个", "这个", "那个", "是不是", "有没有"
]);

// 单字停用子集：用于填充 bigram 判定（bigram 任一字命中即视为跨字噪声）
const SINGLE_STOP = new Set([...STOPWORDS].filter((w) => w.length === 1));

function isFillerBigram(b) {
  return SINGLE_STOP.has(b[0]) || SINGLE_STOP.has(b[1]);
}

// 刀2：把混合词按 CJK / 拉丁数字边界切开（"找bug" -> ["找","bug"]；"vue3" 整段拉丁保持）
function splitRuns(w) {
  const parts = [];
  let cur = "";
  let curCJK = null;
  for (const ch of w) {
    const c = CJK_RE.test(ch);
    if (curCJK === null || c === curCJK) {
      cur += ch;
    } else {
      parts.push(cur);
      cur = ch;
    }
    curCJK = c;
  }
  if (cur !== "") parts.push(cur);
  return parts;
}

export function segment(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    for (const part of splitRuns(w)) {
      if (part === "") continue;
      if (CJK_RE.test(part)) {
        if (part.length === 1) {
          if (!SINGLE_STOP.has(part)) out.push(part);
        } else {
          for (let i = 0; i < part.length - 1; i++) {
            const bigram = part.slice(i, i + 2);
            if (!STOPWORDS.has(bigram) && !isFillerBigram(bigram)) out.push(bigram);
          }
        }
      } else {
        // v7 终局一刀：单字符拉丁 token 直接丢弃 —— "A股"切出的"a"、"A/B"的"a/b"是纯垃圾匹配源
        if (part.length === 1) continue;
        out.push(part);
        if (part.length > 4) {
          for (let i = 0; i < part.length - 2; i++) out.push(part.slice(i, i + 3));
        }
      }
    }
  }
  return out;
}
