const proposal = process.argv[2] || "使用 Redis 内存锁保证订单唯一性";

console.log(`=== 🚨 红蓝对抗压力测试: "${proposal}" ===`);
console.log("【攻击 1 - 网络分区】: Redis 发生主从切换时，未同步的锁可能丢失，导致双写！");
console.log("【攻击 2 - 线程暂停】: 业务逻辑 GC 暂停时间超过 Lock TTL，锁自动释放后引发并发竞态！");
console.log("【防御强化方案】: 引入 Redlock 多数派协议，或增加唯一数据库联合约束作为保底兜底。");
