import worker from '../dist/esa-worker.js';

async function search(q) {
  const req = new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'skill_search', arguments: { query: q, topK: 1, verbose: true } }
    })
  });
  const res = await worker.fetch(req);
  const data = await res.json();
  console.log(`🔎 检索: "${q}"`);
  console.log(`   ${data.result.content[0].text}\n`);
}

async function run() {
  await search('Shadcn UI 下拉菜单无障碍组件设计');
  await search('Vue3 Pinia storeToRefs 响应式解构');
  await search('Spring Boot 3 六边形干净架构与 DDD 领域驱动');
  await search('大模型 Prompt 注入与越狱安全防御');
  await search('Golang context 传递与 goroutine 防泄漏');
  await search('GraphQL Relay 游标分页与 DataLoader');
  await search('正则表达式 ReDoS 灾难性回溯防御');
}

run();
