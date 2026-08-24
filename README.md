# skill-mcp

> 零依赖的 MCP 技能检索服务器 —— 让几十个 SKILL.md 在 1MB 内存、边缘函数环境里被精准召回,域外请求被干净拒绝。

`skill_search` / `skill_get` / `skill_inspect` 三个工具,一个边缘函数 Page 就能跑。不调用任何外部向量服务、不需要数据库、冷启动后检索延迟 20~300ms。

---

## 为什么是它

给 AI 挂技能库时,所有人都会撞上同一个矛盾:

- **全量常驻** —— 几十个 SKILL.md 塞进 system prompt,token 爆炸,99% 的技能在 99% 的对话里是无用负载;
- **全靠模型自己想** —— 不告诉它有什么,它就不会用。

skill-mcp 的答案是**按意图检索,按需注入**:每次请求只用意图匹配出 top-k 个技能,把 token 花在刀刃上。

更进一步,它对"知识"做了二分:

| 类型 | 下发方式 | 例子 |
|------|---------|------|
| **rule(准则)** | MCP 标准的 `initialize.instructions`,握手时一次性常驻 | Clean Code、5-Whys、命名铁律 |
| **tool(技能)** | `skill_search` 按意图检索,`skill_get` 取全文 | SQL 优化、ReDoS 防护、组件规范 |

改变"怎么做事"的准则影响每一次输出,常驻才有意义;提供"做什么事"的工具单次只用一两个,检索才是正解。**常驻负责让 AI 知道它存在,检索负责把全文递到它手上** —— 两条通道各司其职。

---

## 检索管线

```
query ──► CJK 二元组分词(拉丁按词边界切,单字符垃圾 token 过滤)
          │
          ├─► 全局同义词典扩展(扩展词权重 α=0.4,只帮忙不喧宾)
          │
          ▼
┌─────────────────────────────────────────────┐
│  内存级字段加权 BM25 倒排索引                   │
│  name(3.5) ＞ triggers(3.0) ＞ description(2.0) │
├─────────────────────────────────────────────┤
│  2048 维符号哈希空间 · 余弦相似度(零外部调用)      │
├─────────────────────────────────────────────┤
│  内容词覆盖率 cov(停用词/填充成分先滤再算,抗长句稀释) │
└─────────────────────────────────────────────┘
          │
          ▼
  融合打分  fit = 0.6·BM25 + 0.4·Vector + TriggerBonus
          │
          ├─ 地板分闸:原始分(raw,不含惩罚)低于阈值 → 返回空 + 拒绝原因
          ├─ 平坦度闸:top1 与中位数 gap 过小且无 trigger 命中 → 拒
          └─ 常驻 rule:回池参与检索,但 −0.15 惩罚只影响排序、不影响拒识
          │
          ▼
  hits[] + fit + fitReasons(bm25/sem/cov 分数分解,verbose 可查)
```

几个刻意的设计决策,都踩过坑:

- **常驻 rule 回池,而不是剔除**。rule 的 instructions 里只有一行摘要,完整 SOP 在 SKILL.md 里,只能靠检索获取。v3 曾把它们整体剔除,结果"起个好听的变量名"这类明确指向准则的 query 直接装聋。
- **拒识和降权解耦**。地板分看原始分,惩罚只改排名。混在一起的结果是:v2 阈值过宽域外全漏,v3 阈值收紧域内自然语言全灭——同一个缺陷的两面。
- **cov 的分母是内容词,不是全句 bigram**。"这个正则一跑网站就卡死,是不是写法有问题"有 20 个 bigram,只有 2 个是信号;按全句算覆盖率 10%,必死;按内容词算 67%,复活。
- **CJK/拉丁边界必切 + 单字符拉丁 token 丢弃**。`找bug` 两侧切法不一致就永远匹配不上;`A股` 切出单字符 `a` 会和 `A/B` 里的孤立字母打出满分 BM25——垃圾 token 的 IDF 虚高是隐形炸弹。
- **triggers 承担语义,算法保持简单**。哈希向量匹配不了同义词("写死" vs "硬编码"字符零重叠),这部分语义由 triggers(技能侧)和全局同义词典(查询侧)承担,数据比算法便宜。

---

## 实测成绩单

34 条对抗用例(同义改写 / 中英混杂 / 口语化 / 错别字 / 多义歧义 / 域外拒绝 / 域外盲测),六个版本的黑盒实测:

| 版本 | 域内命中* | 域外拒绝 | 那一版发生了什么 |
|------|----------|---------|----------------|
| v1 | 13/13 † | **0/8** | 只有检索没有拒识,"订机票"也能蹭到 0.63 分 |
| v2 | ~11/20 | 8/8 | 抬地板分,域外堵住了,域内自然语言被误杀 |
| v3 | ~10/20 | 12/12 | 常驻 rule 被整体剔除,"起个名字"直接装聋 |
| v4 | 16/20 | 12/12 | rule 回池带惩罚,术语/日常词分流生效 |
| v5 | 16/20 | 12/12 | 摘除高频泄漏词,暴露混合 token 与长句稀释 |
| **v6** | **17/18** | **11/12** | 内容词 cov + token 归一化,距满分一行代码 |
| **v7** | **22/22** | **12/12** | 单字符拉丁 token 清除;本地全量库(69 技能)34 发考卷首次满分 |

\* 严格判定:top1 必须是正确技能,近似替代品不算分。
† v1 的"满分"含水分:测试集与索引词同源,且部分命中靠常驻 rule 的万能描述"碰巧"兜底——这正是后来域外翻车的伏笔。

**六轮迭代的全部 bug 都有尸检报告**:域外黑洞、阈值过拟合、rule 斩首、长句稀释、token 错位、单字符 IDF 炸弹。每个都对应测试集里一条带标注的用例。**AI 爱吹牛,数据不会。**

---

## 快速开始

### 部署服务端

任意支持 JS 的边缘函数平台(Cloudflare Workers / CF Pages Functions / Deno Deploy 等):

```bash
git clone https://github.com/2428424081cn/Skill-mcp.git
cd Skill-mcp
# 把你的技能库放进 skills/,每个技能一个目录:
# skills/<namespace>/<name>/skill.json + SKILL.md
# 构建边缘产物并部署:
node scripts/build-esa.mjs   # -> dist/esa-worker.js,部署为边缘函数 Page,拿到 https://your-domain/mcp
```

`skill.json` 元数据格式:

```jsonc
{
  "name": "sql-query-optimizer",
  "namespace": "data",
  "description": "慢 SQL 诊断:执行计划分析、索引建议、全表扫描识别。",
  "triggers": ["慢sql", "加索引", "explain", "全表扫描"],
  "keywords": ["sql优化", "查询太慢"]
}
```

> triggers 写"用户会怎么说",只放内容词;礼貌填充("帮我看看…")和日常高频词会制造跨域误报,不要放。

### 客户端接入(Streamable HTTP)

LobeChat / Claude Desktop / Cursor 等任意 MCP 客户端:

```json
{
  "mcpServers": {
    "skill-mcp": {
      "type": "streamableHttp",
      "url": "https://your-domain/mcp"
    }
  }
}
```

握手时服务端通过 `initialize.instructions` 下发全局准则清单(当前 14 条常驻 rule),客户端注入模型上下文即可。

---

## API

### `skill_search`

按意图检索技能。

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `query` | string | ✅ | 任务需求描述,自然语言 |
| `topK` | number | | 返回数量上限,默认 5 |
| `verbose` | boolean | | 返回 bm25/sem/cov 分数分解,调优用 |
| `includeRules` | boolean | | 附带常驻准则清单(默认 false,已在 initialize 注入) |

响应:

```jsonc
{
  "count": 2,
  "hits": [
    {
      "key": "data:sql-query-optimizer@1.0.0",
      "name": "sql-query-optimizer",
      "desc": "慢 SQL 诊断:执行计划分析…",
      "fit": 0.87,
      "fitReasons": ["bm25 1.0", "sem 0.31", "cov 67%"]
    }
  ]
}
```

域外请求返回 `{ "count": 0 }` —— **"找不到"是一个显式信号,不是低分凑数**。

### `skill_get`

按 key 获取完整 SKILL.md 执行手册。`skill_search` 命中后由 AI 按需调用。

### `skill_inspect`

查看技能元数据、依赖与文件清单。

---

## 回归测试

仓库内置 [`tests/regression-suite.json`](tests/regression-suite.json):34 条用例,六轮实战沉淀,每条带病史标注(哪一版回归过、为什么)。

- **通过线**:域内 ≥ 20/22,域外零泄漏(top1 fit < 0.55 或返回空)
- **用法**:每次改动权重 / triggers / 分词器后全量跑一遍,单变量迭代
  ```bash
  node scripts/build-esa.mjs && node scripts/test-regression.mjs          # 本地构建产物
  node scripts/test-regression.mjs --remote                               # 打线上环境对照
  ```
- **原则**:测试集与索引词必须不同源——用技能自己的描述改写出来的 query 是自证循环,测不出泛化
- **本地验证**:`node scripts/build-esa.mjs && node scripts/test-tokenizer.mjs`(分词器一致性,直接对构建产物断言)

---

## 已知边界与路线图

诚实清单,按优先级:

- [ ] **REST 类 query 的 top1 排序**:`restful-api-standard` 能进 top3 但会被 graphql/fastapi 的 `rest` 子串压位,无伤大雅但可以更好
- [ ] **遥测闭环**(Langfuse 埋点):记录 选中率 × 实际使用率 × 任务成功率,让 0.6/0.4 融合权重从先验变成数据校准
- [ ] **合成 triggers**:索引时用库内 IDF 自动提取每技能独占词,新技能零人工成本获得召回能力(权重 0.5,只走 BM25 通道)
- [ ] **可选语义档**:本地小模型嵌入(bge-small-zh int8,~30MB)作为哈希向量的升级选项,默认关闭
- [x] ~~单字符拉丁 token IDF 炸弹~~ (v6 修复)

## 环境

- 运行时:任意 JS 边缘函数(无 Node 专属 API 依赖)
- 内存预算:~1MB 索引(50+ 技能)
- MCP 协议:2025-06-18(Streamable HTTP)
- 延迟:热请求 20~300ms,边缘冷启动 ~500ms

## License

MIT
