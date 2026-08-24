// 命名风格转换工具 (camelCase, PascalCase, snake_case, kebab-case, SCREAMING_SNAKE)
const str = process.argv[2] || "user_profile_data";

function splitWords(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .replace(/[_-]+/g, " ")
          .trim()
          .toLowerCase()
          .split(/\s+/);
}

const words = splitWords(str);

const camel = words.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join("");
const pascal = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
const snake = words.join("_");
const kebab = words.join("-");
const screaming = words.map(w => w.toUpperCase()).join("_");

console.log(`=== 🔤 命名风格转换器: "${str}" ===`);
console.log(`• camelCase:             ${camel}`);
console.log(`• PascalCase:            ${pascal}`);
console.log(`• snake_case:            ${snake}`);
console.log(`• kebab-case:            ${kebab}`);
console.log(`• SCREAMING_SNAKE_CASE:  ${screaming}`);
