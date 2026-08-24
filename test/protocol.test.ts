import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpServer } from "../src/protocol/mcp.ts";

test("initialize / tools/list / tools/call 全链路", async () => {
  const calls: string[] = [];
  const server = createMcpServer({
    name: "test-server", version: "0.0.1",
    tools: [{ name: "echo", description: "echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }],
    callTool: async (name, args) => {
      calls.push(name + ":" + String((args || {}).text));
      return { content: [{ type: "text", text: "you said " + String((args || {}).text) }], structuredContent: { echo: String((args || {}).text) } };
    },
  });

  const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const initRes = init as any;
  assert.equal(initRes.result.serverInfo.name, "test-server");
  assert.equal(initRes.result.protocolVersion, "2025-06-18");
  assert.ok(initRes.result.capabilities.tools);

  const list = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal((list as any).result.tools.length, 1);

  const call = await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
  assert.equal((call as any).result.content[0].text, "you said hi");
  assert.equal((call as any).result.structuredContent.echo, "hi");
  assert.deepEqual(calls, ["echo:hi"]);

  // 通知返回 null
  const notif = await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notif, null);

  // 未知方法 -> -32601
  const unknown = await server.handle({ jsonrpc: "2.0", id: 4, method: "nope" });
  assert.equal((unknown as any).error.code, -32601);

  // 非法请求 -> -32600
  const invalid = await server.handle({ jsonrpc: "1.0", id: 5, method: "ping" });
  assert.equal((invalid as any).error.code, -32600);

  // 工具内部抛错 -> isError
  const server2 = createMcpServer({
    name: "boom", version: "0.0.1",
    tools: [{ name: "boom", description: "", inputSchema: { type: "object" } }],
    callTool: async () => { throw new Error("kaboom"); },
  });
  await server2.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const boom = await server2.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom", arguments: {} } });
  assert.equal((boom as any).result.isError, true);
  assert.match((boom as any).result.content[0].text, /kaboom/);
});

test("resources 与 prompts", async () => {
  const server = createMcpServer({
    name: "r", version: "0.0.1",
    tools: [],
    callTool: async () => ({ content: [{ type: "text", text: "" }] }),
    resources: [{ uri: "skills://catalog", name: "catalog", mimeType: "application/json" }],
    readResource: async (uri) => [{ uri, mimeType: "application/json", text: "{\"n\":1}" }],
    prompts: [{ name: "briefing", description: "brief", arguments: [{ name: "task", required: true }] }],
    getPrompt: async (name, args) => ({
      messages: [{ role: "user", content: { type: "text", text: "task: " + String((args || {}).task) } }],
    }),
  });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const rl = await server.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.equal((rl as any).result.resources[0].uri, "skills://catalog");
  const rr = await server.handle({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "skills://catalog" } });
  assert.equal((rr as any).result.contents[0].text, "{\"n\":1}");
  const pg = await server.handle({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "briefing", arguments: { task: "总结" } } });
  assert.equal((pg as any).result.messages[0].content.text, "task: 总结");
});
