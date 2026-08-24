// 端到端：真实 skill 库 + 全部子系统（检索/规划/执行/权限/评价）的进程内闭环
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";

async function makeServer() {
  const dataDir = mkdtempSync(join(tmpdir(), "skill-mcp-e2e-"));
  const { server } = await createSkillMcp({
    skillsDir: join(process.cwd(), "skills"),
    dataDir,
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await server.handle({
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
    });
    const r = res as { error?: unknown; result?: { isError?: boolean; content?: { text?: string }[]; structuredContent?: Record<string, unknown> } };
    assert.ok(!r.error, "rpc error: " + JSON.stringify(r.error));
    assert.ok(!r.result?.isError, "tool error: " + (r.result?.content?.[0]?.text ?? ""));
    return r.result!.structuredContent as Record<string, any>;
  };
  return { server, call };
}

test("e2e 完整闭环：检索 -> 规划 -> 数据流执行 -> 权限 HITL -> 反馈 -> 评价", async () => {
  const { server, call } = await makeServer();

  // initialize + tools/list
  const init = await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} });
  assert.equal((init as any).result.serverInfo.name, "skill-mcp");
  const tl = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal((tl as any).result.tools.length, 9);

  // 1) 混合检索 + 适配打分
  const s = await call("skill_search", { query: "把 CSV 数据统计后生成 Markdown 报表" });
  assert.equal(s.hits[0].key, "report:markdown-report@1.0.0");
  assert.ok(s.hits[0].fitReasons.length >= 1);

  // 2) 自动组合成 DAG
  const plan = await call("skill_plan", { task: "从 CSV 数据生成 Markdown 报表" });
  assert.deepEqual(
    plan.nodes.map((n: any) => n.skillKey),
    ["data:csv-parse@1.0.0", "data:csv-stats@1.0.0", "report:markdown-report@1.0.0"],
  );

  // 3) workflow 数据流执行
  const wf = await call("workflow_run", {
    dag: { id: plan.id, nodes: plan.nodes.map((n: any) => ({ id: n.id, skillKey: n.skillKey, inputs: n.inputs })), edges: plan.edges },
    inputs: { csv: "name,value\na,1\nb,2" },
  });
  assert.equal(wf.ok, true);
  assert.equal(wf.steps.step1.status, "success");
  assert.equal(wf.steps.step2.status, "success");
  assert.equal(wf.steps.step3.status, "success");
  assert.match(wf.steps.step3.output.markdown, /记录数: 2/);
  assert.match(wf.steps.step3.output.markdown, /\| value \| 1.5 \|/);

  // 4) 权限隔离：network 默认 ask -> requiresApproval
  const denied = await call("skill_run", { skill: "web:fetch-page", inputs: { url: "http://example.com" } });
  assert.equal(denied.requiresApproval, true);
  assert.equal(denied.asks[0].permission, "network");

  // 5) 单 skill 执行
  const sum = await call("skill_run", { skill: "text:summarize", inputs: { text: "一二三四五六七八九十，这是一段文本。" }, task: "总结" });
  assert.equal(sum.outcome, "success");
  assert.equal(typeof sum.output.summary, "string");

  // 6) 反馈 -> 排名学习
  await call("skill_feedback", { skill: "text:summarize", outcome: "success", rating: 5, task: "总结" });
  const st = await call("skill_stats", { key: "text:summarize@1.0.0" });
  assert.equal(st.stats.successes, 1);
  assert.ok(st.quality > 0);

  // 7) recipe 挖掘（step1+step2+step3 已被记录为 workflow）
  const all = await call("skill_stats", {});
  assert.ok(all.recipes.some((r: any) => r.chain.length === 3));

  // 8) 资源
  const rr = await server.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "skills://catalog" } });
  assert.match((rr as any).result.contents[0].text, /summarize/);
});

test("e2e 权限 HITL 两段式：approveAsks 授权后进入执行路径", async () => {
  const { call } = await makeServer();
  const first = await call("skill_run", { skill: "fs:organize-files", inputs: { directory: "." } });
  assert.equal(first.requiresApproval, true);
  // 授权后重试：mutating 写权限获批，进入执行（inline 为 dry-run 计划，无真实副作用）
  const second = await call("skill_run", { skill: "fs:organize-files", inputs: { directory: "." }, approveAsks: true });
  assert.equal(second.outcome, "success");
  assert.equal(second.output.dryRun, true);
});
