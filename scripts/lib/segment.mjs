// 单一分词器（Single Source of Truth）—— 修 3 的核心不变量
// 「索引侧」与「查询侧」必须走同一个 segment()：两侧 token 对得上，召回才对得上。
// 使用方：
//   - scripts/build-esa.mjs   构建时（IDF 合成 triggers、BM25 字段入倒排前）
//   - dist/esa-worker.js      运行时（内嵌本文件镜像副本，函数名同为 segment）
//   - scripts/test-tokenizer.mjs 部署前直接从构建产物导入 segment 做一致性验证
//
// 规则：
//   - lowercase 归一
//   - 按 [^0-9a-z\u4e00-\u9fff] 词边界切分，拉丁+数字整词保留（vue3 不拆碎）
//   - CJK 连续段做二元组切分（不含整短语 token），停用词在词级与 bigram 级双重过滤
//   - 拉丁词长 >4 附带字符三元组（召回片，属设计行为）

export const CJK_RE = /[\u4e00-\u9fff]/;

export const STOPWORDS = new Set([
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "么", "怎", "才", "做", "把", "给", "让", "被", "及", "等", "与", "或", "什么", "怎么", "如何", "怎样", "为什么", "推荐", "几个", "几部", "今天", "明天", "需要", "带", "请问", "帮我", "一下", "可以", "怎么做", "支持", "提供", "使用", "进行", "相关", "问题", "处理", "实现", "工具", "助手", "功能", "基于", "用于"
]);

export function segment(text) {
  const lower = String(text || "").toLowerCase();
  const words = lower.split(/[^0-9a-z\u4e00-\u9fff]+/).filter((w) => w.length > 0);
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    if (CJK_RE.test(w)) {
      if (w.length === 1) {
        if (!STOPWORDS.has(w)) out.push(w);
      } else {
        // 纯二元组：保证「正则卡死」-> 含 正则/则卡/卡死，绝无整短语 token
        for (let i = 0; i < w.length - 1; i++) {
          const bigram = w.slice(i, i + 2);
          if (!STOPWORDS.has(bigram)) out.push(bigram);
        }
      }
    } else {
      out.push(w);
      if (w.length > 4) {
        for (let i = 0; i < w.length - 2; i++) out.push(w.slice(i, i + 3));
      }
    }
  }
  return out;
}
