// 手术式修法：为常驻 rule 技能清洗 triggers，只保留高精度专业术语词，剔除口语化日常词汇
// 原则：常驻 rule 的 trigger 只留能唯一指向该规则的精确词汇，日常词如"没头绪/纠结/挑刺/选不准"全部删除
// 这些日常词是域外黑洞的燃料，但又是 rule 被召回的路径——解法是让日常词走同义词典间接召回

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// 每条 rule 保留的高精度触发词白名单（只留能唯一指向该规则的专业词）
const RULE_PRECISION_TRIGGERS = {
  "ai:llm-prompt-injection-defense": [
    // 高精度术语（技术人才能说出的词）
    "prompt injection", "提示词注入", "越狱", "越权指令", "大模型安全",
    "system prompt 保护", "防套出提示词", "输入隔离", "xml定界",
    "注入攻击", "恶意指令", "llm安全"
  ],
  "arch:clean-code-solid": [
    "refactor", "clean-code", "solid原则", "单一职责", "开闭原则", "干净架构",
    "设计原则", "solid", "lsp", "dip", "ocp", "srp", "面条代码", "意大利面代码"
  ],
  "design:modern-ui-aesthetics": [
    "配色", "排版", "视觉层次", "高级感", "现代ui", "glassmorphism",
    "渐变色", "深色模式", "neumorphism", "color palette", "ui美学"
  ],
  "dev:code-review-guard": [
    "代码审查", "code review", "静态审查", "扫描代码漏洞", "code-review-guard",
    "代码质量", "坏味道", "代码异味", "安全审计代码"
  ],
  "dev:git-conventional-commits": [
    "commit", "conventional commits", "feat", "fix", "commit规范",
    "提交规范", "semantic commit", "angular commit"
  ],
  "dev:naming-conventions": [
    "命名规范", "变量命名", "naming-conventions", "函数命名规则",
    "布尔值命名", "驼峰命名", "camelcase", "pascal case", "命名约定"
  ],
  "dev:typescript-strict-guard": [
    "typescript strict", "ts strict", "noImplicitAny", "strictNullChecks",
    "类型守卫", "类型收窄", "ts类型安全", "typescript规范"
  ],
  "reasoning:adversarial-critic": [
    "红蓝对抗", "魔鬼代言人", "adversarial-critic", "寻找反例",
    "压力测试方案", "攻击假设", "devil advocate"
  ],
  "reasoning:chain-of-verification": [
    "chain-of-verification", "cove", "防幻觉", "交叉验证",
    "多步验证", "逐步确认", "事实核查"
  ],
  "reasoning:decision-tradeoff-matrix": [
    "决策矩阵", "权衡分析", "decision-tradeoff-matrix", "技术选型对比",
    "方案评估打分", "多维度打分", "tradeoff matrix", "加权评分"
  ],
  "reasoning:first-principles": [
    "第一性原理", "first-principles", "底层推导", "本质分析",
    "从公理推导", "elon musk思维", "公理推导", "first principles"
  ],
  "reasoning:root-cause-5whys": [
    "5whys", "5个为什么", "根因分析", "root-cause-5whys",
    "故障溯源", "追查根因", "为什么为什么", "five whys"
  ],
  "reasoning:sequential-thinking": [
    "sequential-thinking", "思维链", "多步推演",
    "chain of thought", "cot", "step by step思考", "逐步推导"
  ],
  "web:restful-api-standard": [
    "restful", "rest api规范", "http语义", "接口规范", "uri命名规范",
    "api设计规范", "http状态码规范", "统一响应格式"
  ]
};

const skillsDir = join(process.cwd(), "skills");

function findAndClean(dir) {
  const entries = [];
  try {
    const ents = require("node:fs").readdirSync(dir, { withFileTypes: true });
    entries.push(...ents);
  } catch(e) { return; }
  
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (existsSync(join(full, "skill.json"))) {
        const m = JSON.parse(readFileSync(join(full, "skill.json"), "utf8"));
        const skillKey = (m.namespace ? m.namespace + ":" : "") + m.name;
        if (m.skillType === "rule" && RULE_PRECISION_TRIGGERS[skillKey]) {
          const oldCount = (m.triggers || []).length;
          m.triggers = RULE_PRECISION_TRIGGERS[skillKey];
          m.keywords = RULE_PRECISION_TRIGGERS[skillKey]; // keywords 也同步清洗
          writeFileSync(join(full, "skill.json"), JSON.stringify(m, null, 2), "utf8");
          console.log(`[✂️ 清洗] ${skillKey}: ${oldCount} → ${m.triggers.length} triggers`);
        }
      } else {
        findAndClean(full);
      }
    }
  }
}

import { readdirSync } from "node:fs";
findAndClean(skillsDir);
console.log("\n✅ Rule trigger 外科清洗完成！");
