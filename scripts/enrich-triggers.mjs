// 批量为所有技能扩充丰富、地道的中文自然语言 Triggers 与 Keywords (口语化、场景化)
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const skillsDir = join(process.cwd(), "skills");

const triggerExpansions = {
  // 1. 安全与凭据
  "sec:security-secret-scanner": [
    "写死", "硬编码", "明文密码", "揪出来", "查密", "token泄露", "敏感信息", "aws key", "api key", "泄露密码", "扫私钥", "私钥泄漏", "凭据扫描"
  ],
  "sec:dependency-vulnerability-audit": [
    "依赖漏洞", "包安全", "三方库漏洞", "cve", "供应链安全", "npm audit", "pip audit", "恶意包", "库有漏洞吗", "安全补丁", "依赖更新检查"
  ],
  "sec:owasp-top10-auditor": [
    "web安全", "owasp", "sql注入", "xss", "跨站脚本", "csrf", "未授权访问", "安全审计", "越权漏洞", "安全漏洞检查"
  ],
  "sec:regex-redos-safe-builder": [
    "正则卡死", "redos", "灾难性回溯", "正则慢", "正则优化", "安全正则", "正则表达式漏洞", "正则报错", "正则性能"
  ],

  // 2. 规范与命名
  "dev:naming-conventions": [
    "起名", "取名", "起个名字", "叫什么好", "变量名", "函数命名", "布尔值命名", "命名规范", "驼峰命名", "命名建议", "怎么命名"
  ],
  "dev:typescript-strict-guard": [
    "ts类型", "不要any", "类型报错", "泛型", "联合类型", "类型收窄", "类型推导", "严格模式", "ts规范", "类型守卫"
  ],
  "dev:code-review-guard": [
    "代码审查", "帮我看看代码", "找茬", "审查代码", "代码质量", "坏味道", "代码优化建议", "code review", "检查bug", "挑毛病"
  ],
  "arch:clean-code-solid": [
    "重构", "设计模式", "solid原则", "代码太乱", "解耦", "单一职责", "开闭原则", "干净架构", "代码异味", "抽象封装"
  ],

  // 3. 思维与推理
  "reasoning:root-cause-5whys": [
    "没头绪", "找bug", "排查", "调试", "定位问题", "故障根因", "5whys", "为什么报错", "线上事故", "深入分析", "根因分析", "追查原因"
  ],
  "reasoning:decision-tradeoff-matrix": [
    "选不准", "纠结", "怎么选", "对比", "技术选型", "方案对比", "哪个好", "权衡利弊", "打分矩阵", "架构选型", "优缺点对比"
  ],
  "reasoning:chain-of-verification": [
    "防幻觉", "验证事实", "交叉验证", "一步步确认", "检查准确性", "验证步骤", "自检", "cove"
  ],
  "reasoning:sequential-thinking": [
    "复杂问题", "理清思路", "一步步推导", "思维链", "动态推演", "拆解问题", "深度思考", "推导演变"
  ],
  "reasoning:first-principles": [
    "第一性原理", "本质是什么", "底层逻辑", "从零推导", "回归根本", "打破常规", "公理推导"
  ],
  "reasoning:adversarial-critic": [
    "挑刺", "魔鬼代言人", "红蓝对抗", "找漏洞", "极限测试", "攻击方案", "边界攻击", "反面论证"
  ],

  // 4. 前端
  "frontend:shadcn-ui-radix-architect": [
    "shadcn", "radix", "ui组件", "弹窗", "下拉菜单", "对话框", "tailwind组件", "无障碍组件", "dialog", "dropdown", "漂亮组件", "组件库"
  ],
  "frontend:vue3-pinia-composition": [
    "vue3", "pinia", "script setup", "响应式丢失", "storetorefs", "vue状态", "vue组件", "vue响应式", "组合式api"
  ],
  "frontend:tanstack-query-patterns": [
    "react query", "tanstack query", "缓存更新", "乐观更新", "数据同步", "usequery", "usemutation", "自动刷新", "请求缓存"
  ],
  "frontend:tailwind-v4-design-system": [
    "tailwind4", "tailwind v4", "css变量", "设计系统", "色彩搭配", "@theme", "容器查询", "样式规范"
  ],
  "dev:react-nextjs-architect": [
    "react19", "nextjs", "app router", "服务端组件", "rsc", "前端架构", "页面卡顿", "组件封装", "前端状态", "路由跳转"
  ],

  // 5. 后端与数据库
  "backend:spring-boot-clean-architecture": [
    "spring boot", "java架构", "分层架构", "ddd", "六边形", "controller", "service层", "领域模型", "实体类", "mapstruct"
  ],
  "backend:golang-idiomatic-patterns": [
    "golang", "go规范", "协程泄露", "goroutine", "context传递", "go错误", "%w", "channel", "并发安全", "go报错", "panic"
  ],
  "backend:nestjs-prisma-drizzle": [
    "nestjs", "prisma", "drizzle", "node后端", "type-safe orm", "dto校验", "依赖注入", "nestjs模块", "数据库迁移"
  ],
  "backend:graphql-schema-design": [
    "graphql", "dataloader", "n+1", "游标分页", "graphql接口", "schema设计", "apollo"
  ],
  "data:sql-query-optimizer": [
    "慢sql", "sql优化", "加索引", "全表扫描", "explain", "数据库慢", "查询太慢", "联合索引", "sql优化建议"
  ],
  "db:db-schema-inspector": [
    "看表结构", "建表", "数据库表", "主键", "外键", "表字段", "查看数据库", "ddl"
  ],
  "web:restful-api-standard": [
    "restful", "api设计", "http状态码", "接口规范", "统一响应", "uri命名", "接口文档", "api标准"
  ],
  "dev:fastapi-rest-service": [
    "fastapi", "python api", "pydantic", "python后端", "uvicorn", "异步接口", "python路由"
  ],

  // 6. DevOps 与工作流
  "devops:docker-ops-assistant": [
    "docker", "容器挂了", "dockerfile", "多阶段构建", "镜像瘦身", "端口映射", "容器编排", "docker status"
  ],
  "devops:ci-cd-github-actions": [
    "github actions", "ci cd", "自动化流水线", "自动部署", "持续集成", "actions报错", "流水线优化"
  ],
  "dev:git-workflow-pro": [
    "git暂存", "git提交", "怎么commit", "代码变动", "写commit", "生成提交信息", "git workflow"
  ],
  "dev:git-conventional-commits": [
    "commit规范", "conventional commits", "feat", "fix", "提交前缀", "规范化commit"
  ],
  "dev:semantic-release-changelog": [
    "版本号", "发版", "changelog", "semver", "语义化版本", "自动生成更新日志", "release notes"
  ],
  "arch:architecture-decision-records": [
    "adr", "架构决策", "选型论证", "技术决策", "rfc文档", "技术方案记录", "架构评审"
  ],

  // 7. LLM 与 AI
  "ai:llm-prompt-injection-defense": [
    "提示词注入", "prompt injection", "越狱", "越权指令", "大模型安全", "防套出提示词", "输入隔离", "xml定界"
  ],
  "ai:structured-output-json-schema": [
    "结构化输出", "json schema", "大模型返回json", "function calling", "zod校验", "解析json报错"
  ],

  // 8. 测试
  "test:vitest-pytest-unit-testing": [
    "单测", "单元测试", "vitest", "pytest", "mock", "测试用例", "断言", "aaa模式", "测试覆盖率"
  ]
};

function enrichDir(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (existsSync(join(full, "skill.json"))) {
        const m = JSON.parse(readFileSync(join(full, "skill.json"), "utf8"));
        const skillKey = (m.namespace ? m.namespace + ":" : "") + m.name;
        if (triggerExpansions[skillKey]) {
          const currentTriggers = new Set(m.triggers || []);
          const currentKeywords = new Set(m.keywords || []);
          for (const t of triggerExpansions[skillKey]) {
            currentTriggers.add(t);
            currentKeywords.add(t);
          }
          m.triggers = Array.from(currentTriggers);
          m.keywords = Array.from(currentKeywords);
          writeFileSync(join(full, "skill.json"), JSON.stringify(m, null, 2), "utf8");
          console.log(`[+] 成功扩充触发词: ${skillKey} (${m.triggers.length} 个 triggers)`);
        }
      } else {
        enrichDir(full);
      }
    }
  }
}

enrichDir(skillsDir);
console.log("\n🎉 语义数据下沉完成！");
