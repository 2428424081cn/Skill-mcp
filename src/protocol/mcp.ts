// MCP 服务器核心：JSON-RPC 分发（tools / resources / prompts）
// 与传输层解耦：stdio 与进程内测试共用同一 dispatcher
import { makeError, makeResult, ERR_METHOD_NOT_FOUND, ERR_INVALID_PARAMS, ERR_INTERNAL } from "./jsonrpc.ts";
import type { JsonRpcResponse } from "./jsonrpc.ts";
import type { JsonValue } from "../types.ts";

export interface ToolContent { type: "text"; text: string }
export interface ToolResult { content: ToolContent[]; isError?: boolean; structuredContent?: JsonValue }
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ResourceSpec { uri: string; name: string; description?: string; mimeType?: string }
export interface ResourceContent { uri: string; mimeType?: string; text?: string }
export interface PromptSpec { name: string; description?: string; arguments?: { name: string; description?: string; required?: boolean }[] }
export interface PromptResult { description?: string; messages: { role: "user" | "assistant"; content: { type: "text"; text: string } }[] }

export interface McpServerOptions {
  name: string;
  version: string;
  instructions?: string;
  tools: ToolSpec[];
  callTool: (name: string, args: Record<string, JsonValue> | undefined) => Promise<ToolResult>;
  resources?: ResourceSpec[];
  readResource?: (uri: string) => Promise<ResourceContent[]>;
  prompts?: PromptSpec[];
  getPrompt?: (name: string, args: Record<string, string> | undefined) => Promise<PromptResult>;
  onInitialized?: () => Promise<void> | void;
}

export interface McpServer {
  handle(msg: unknown): Promise<JsonRpcResponse | null>;
  notify(method: string, params?: Record<string, unknown>): void;
  setNotify(fn: (method: string, params?: Record<string, unknown>) => void): void;
}

export function createMcpServer(opts: McpServerOptions): McpServer {
  const serverInfo = { name: opts.name, version: opts.version };
  const capabilities: Record<string, unknown> = { tools: {} };
  if (opts.resources && opts.resources.length > 0) capabilities.resources = {};
  if (opts.prompts && opts.prompts.length > 0) capabilities.prompts = {};
  let notifyFn: (method: string, params?: Record<string, unknown>) => void = () => {};

  function badParams(message: string): never {
    const e = new Error(message) as Error & { code: number };
    e.code = ERR_INVALID_PARAMS;
    throw e;
  }

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2025-06-18",
          capabilities,
          serverInfo,
          instructions: opts.instructions,
        };
      case "ping":
        return {};
      case "tools/list":
        return { tools: opts.tools };
      case "tools/call": {
        const name = p.name;
        if (typeof name !== "string") badParams("tools/call requires string name");
        const args = p.arguments !== undefined && p.arguments !== null ? p.arguments : undefined;
        try {
          return await opts.callTool(name, args as Record<string, JsonValue> | undefined);
        } catch (e) {
          const text = "tool error: " + (e instanceof Error ? e.message : String(e));
          return { content: [{ type: "text", text }], isError: true } as ToolResult;
        }
      }
      case "resources/list": {
        if (!opts.resources) badParams("server has no resources");
        return { resources: opts.resources };
      }
      case "resources/read": {
        const uri = p.uri;
        if (typeof uri !== "string") badParams("resources/read requires uri");
        if (!opts.readResource) badParams("server has no resource reader");
        return { contents: await opts.readResource(uri) };
      }
      case "prompts/list":
        return { prompts: opts.prompts ?? [] };
      case "prompts/get": {
        const name = p.name;
        if (typeof name !== "string") badParams("prompts/get requires name");
        if (!opts.getPrompt) badParams("server has no prompt provider");
        return await opts.getPrompt(name, (p.arguments ?? {}) as Record<string, string>);
      }
      default: {
        const e = new Error("method not found: " + method) as Error & { code: number };
        e.code = ERR_METHOD_NOT_FOUND;
        throw e;
      }
    }
  }

  return {
    notify(method, params) {
      notifyFn(method, params);
    },
    setNotify(fn) {
      notifyFn = fn;
    },
    async handle(msg): Promise<JsonRpcResponse | null> {
      const m = msg as Record<string, unknown> | null;
      if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
        return makeError(null, -32600, "Invalid Request");
      }
      const id = (m.id as string | number) ?? null;
      if (m.method === "notifications/initialized") {
        try { await opts.onInitialized?.(); } catch { /* 初始化回调失败不致命 */ }
        return null;
      }
      if (m.method.startsWith("notifications/")) return null;
      try {
        const result = await dispatch(m.method, m.params);
        return makeResult(id, result);
      } catch (e) {
        const err = e as Error & { code?: number };
        return makeError(id, typeof err.code === "number" ? err.code : ERR_INTERNAL, err.message || String(e));
      }
    },
  };
}
