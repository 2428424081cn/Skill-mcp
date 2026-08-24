console.log("=== 📊 架构决策加权评分矩阵计算 ===");
const data = [
  { option: "方案 A (PostgreSQL + JSONB)", perf: 8, dx: 9, ops: 9, cost: 9, reversibility: 8 },
  { option: "方案 B (专用 MongoDB 集群)", perf: 9, dx: 8, ops: 6, cost: 7, reversibility: 5 }
];

const weights = { perf: 0.25, dx: 0.25, ops: 0.20, cost: 0.15, reversibility: 0.15 };

data.forEach(d => {
  const score = (d.perf * weights.perf) + (d.dx * weights.dx) + (d.ops * weights.ops) + (d.cost * weights.cost) + (d.reversibility * weights.reversibility);
  console.log(`🎯 ${d.option} -> 最终综合得分: ${score.toFixed(2)} / 10`);
});
console.log("\n【结论推荐】: 方案 A 在运维成熟度与决策可逆性上优势明显，综合性价比最高。");
