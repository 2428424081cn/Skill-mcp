// MCP HTTP transport（v2）：Streamable HTTP —— POST /mcp 收发 JSON-RPC。
// 响应按 Accept 协商：application/json（默认）或 text/event-stream（SSE：message 事件 + done）。
// 通知（无 id）返回 202 Accepted；GET /mcp 返回 405。零依赖 node:http。
import { createServer as createHttpServer } from "node:http";
import type { McpServer } from "./mcp.ts";

export interface HttpTransportOptions {
  server: McpServer;
  host?: string;
  port?: number;
  log?: (line: string) => void;
}

export interface HttpTransport {
  listen(): Promise<number>; // 实际端口（port=0 时由系统分配）
  close(): void;
}

const PROTOCOL_VERSION = "2025-06-18";
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB 上限

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startHttpTransport(opts: HttpTransportOptions): HttpTransport {
  const host = opts.host ?? "127.0.0.1";
  const http = createHttpServer(async (req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0];
      if (url !== "/mcp" && url !== "/") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
        res.end("MCP endpoint accepts POST only");
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(await readBody(req));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        return;
      }
      const resp = await opts.server.handle(msg);
      if (resp === null) {
        // 通知：无响应体
        res.writeHead(202, { "mcp-protocol-version": PROTOCOL_VERSION });
        res.end();
        return;
      }
      const accept = String(req.headers.accept ?? "application/json");
      if (accept.includes("text/event-stream")) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "mcp-protocol-version": PROTOCOL_VERSION,
        });
        res.write(`event: message\ndata: ${JSON.stringify(resp)}\n\n`);
        res.end("event: done\ndata: {}\n\n");
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "mcp-protocol-version": PROTOCOL_VERSION });
      res.end(JSON.stringify(resp));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      opts.log?.("http handler error: " + msg);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error", data: msg } }));
      } else {
        res.end();
      }
    }
  });

  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(opts.port ?? 0, host, () => {
          const addr = http.address() as { port: number } | null;
          resolve(addr ? addr.port : 0);
        });
      }),
    close: () => http.close(),
  };
}
