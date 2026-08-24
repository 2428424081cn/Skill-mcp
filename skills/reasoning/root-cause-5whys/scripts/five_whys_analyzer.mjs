const incident = process.argv[2] || "线上服务内存溢出 (OOM) 崩溃";

console.log(`=== 🔍 5-Whys 根本原因穿透推导: "${incident}" ===`);
console.log("Why 1: 内存中的某个数组无限增长，耗尽了 2GB 堆内存。");
console.log("Why 2: 定时任务消费消息队列时，未设置消费批次上限 (Batch Limit)。");
console.log("Why 3: 上游突发流量产生了 100 万条消息，代码尝试一次性加载全部消息到内存。");
console.log("Why 4: 开发者假设‘上游流量每天不超过 1 万条’（隐含不安全假设）。");
console.log("Why 5: 架构规范未强制要求所有消息消费必须采用流式或分页拉取（根因）。");
console.log("\n🎯 【终极治本方案】: 制定全局流式处理规范，并增加内存水位熔断背压（Backpressure）。");
