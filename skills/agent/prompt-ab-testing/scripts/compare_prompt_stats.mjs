const pA = process.argv[2] || "You are a helpful assistant.";
const pB = process.argv[3] || "You are an expert coding assistant. Follow strict type safety.";

console.log("=== Prompt 静态指标对比 ===");
console.log(`Prompt A: ${pA.length} 字符 | 预估 Token: ~${Math.ceil(pA.length / 4)}`);
console.log(`Prompt B: ${pB.length} 字符 | 预估 Token: ~${Math.ceil(pB.length / 4)}`);
console.log("\n【建议】：Prompt B 包含明确的角色专家设定与输出准则约束，通常稳定性更高。");
