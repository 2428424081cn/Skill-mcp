console.log("=== Redis 高并发缓存核心模式示例 ===");
console.log("1. 带随机抖动的防雪崩 TTL 计算:");
const baseTTL = 3600;
const jitter = Math.floor(Math.random() * 300);
console.log(`   实际 TTL = ${baseTTL} + ${jitter} = ${baseTTL + jitter} 秒\n`);

console.log("2. 原子性获取分布式锁命令:");
console.log("   SET resource_name my_unique_token NX PX 30000\n");
