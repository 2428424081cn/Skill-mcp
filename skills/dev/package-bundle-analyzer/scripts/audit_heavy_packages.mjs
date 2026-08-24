import { readFileSync, existsSync } from "node:fs";

const pkgPath = process.argv[2] || "package.json";
if (!existsSync(pkgPath)) {
  console.log("未找到 package.json 文件。");
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

const HEAVY_MAP = {
  "moment": "体积大(~300KB)，建议替换为 dayjs (2KB) 或 date-fns",
  "lodash": "建议使用 lodash-es 实现按需 Tree-Shaking 或使用原生语法",
  "request": "已被官方废弃，建议迁移至 fetch 或 undici"
};

console.log("=== 第三方依赖包体积与健康审计 ===");
let found = 0;
for (const [dep, advice] of Object.entries(HEAVY_MAP)) {
  if (deps[dep]) {
    found++;
    console.log(`⚠️ 发现重型依赖: ${dep} (@${deps[dep]}) -> ${advice}`);
  }
}
if (found === 0) console.log("✅ 未发现典型已知重型或废弃依赖包。");
