const problem = process.argv[2] || "如何提升分布式系统的写入吞吐？";

console.log(`=== 🔬 第一性原理拆解: ${problem} ===`);
console.log("1. 【剥离表面假设】: 必须使用第三方消息中间件吗？必须落盘两次吗？");
console.log("2. 【底层硬约束】: 磁盘顺序写 (500MB/s) 远快于随机写 (5MB/s)；网络单次往返延迟不可消除。");
console.log("3. 【自底向上重构】: 基于内存批量聚合 + 顺序 Append-Only Log (WAL) 实现极致写入。");
