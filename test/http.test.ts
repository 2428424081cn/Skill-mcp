// v2 HTTP transport：Streamable HTTP（POST /mcp，JSON 与 SSE 两种响应）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSkillMcp } from "../src/server.ts";
import { startHttpTransport } from "../src/protocol/http.ts";

async function boot(): Promise<{ base: string; shutdown: () => void }> {
  const root = mkdtempSync(join(tmpdir(), "skill-mcp-http-"));
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  const { server, ctx } = await createSkillMcp({ skillsDir: skills, dataDir: join(root, "data") });
  const transport = startHttpTransport({ server });
  const port = await transport.listen();
  return {
    base: `http://127.0.0.1:${port}`,
    shutdown: () => {
      transport.close();
      ctx.telemetry.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("http: initialize + tools/call JSON roundtrip", async () => {
  const { base, shutdown } = await boot();
  try {
    const initRes = await fetch(base + "/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert.equal(initRes.status, 200);
    assert.equal(initRes.headers.get("mcp-protocol-version"), "2025-06-18");
    const init = await initRes.json();
    assert.equal(init.result.serverInfo.name, "skill-mcp");
    assert.ok(init.result.capabilities.tools);

    const listRes = await fetch(base + "/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const list = await listRes.json();
    assert.equal(list.result.tools.length, 9);

    const searchRes = await fetch(base + "/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "skill_search", arguments: { query: "csv 统计" } } }),
    });
    const search = await searchRes.json();
    assert.equal(search.result.isError, undefined);
    assert.ok(Array.isArray(search.result.structuredContent.hits));
  } finally {
    shutdown();
  }
});

test("http: notification -> 202, GET -> 405, parse error -> 400, SSE accept", async () => {
  const { base, shutdown } = await boot();
  try {
    const notif = await fetch(base + "/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notif.status, 202);

    const get = await fetch(base + "/mcp");
    assert.equal(get.status, 405);

    const bad = await fetch(base + "/mcp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.error.code, -32700);

    const sse = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "ping" }),
    });
    assert.equal(sse.status, 200);
    assert.match(sse.headers.get("content-type") ?? "", /text\/event-stream/);
    const text = await sse.text();
    assert.match(text, /event: message/);
    assert.match(text, /event: done/);
  } finally {
    shutdown();
  }
});
