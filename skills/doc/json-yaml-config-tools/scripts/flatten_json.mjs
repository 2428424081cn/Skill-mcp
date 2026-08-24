import { readFileSync } from "node:fs";

const file = process.argv[2] || "package.json";

function flatten(obj, prefix = "") {
  let res = {};
  for (const k in obj) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(res, flatten(obj[k], key));
    } else {
      res[key] = obj[k];
    }
  }
  return res;
}

try {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const flat = flatten(json);
  console.log(`=== JSON 扁平化结果 (${file}) ===`);
  console.log(JSON.stringify(flat, null, 2));
} catch (e) {
  console.error("处理失败:", e.message);
}
