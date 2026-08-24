// MCP stdio transport：stdin 逐行 JSON-RPC -> dispatcher -> stdout
import { createInterface } from "node:readline";
import { makeError, ERR_PARSE, ERR_INTERNAL } from "./jsonrpc.ts";
import type { McpServer } from "./mcp.ts";

export interface StdioOptions {
  server: McpServer;
  log?: (line: string) => void;
  onClose?: () => void;
}

export function startStdio(opts: StdioOptions): void {
  const send = (msg: unknown): void => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };
  opts.server.setNotify((method, params) => send({ jsonrpc: "2.0", method, params }));

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send(makeError(null, ERR_PARSE, "Parse error"));
      return;
    }
    Promise.resolve(opts.server.handle(msg))
      .then((resp) => { if (resp) send(resp); })
      .catch((e) => {
        opts.log?.("handler error: " + String(e));
        const id = (msg as { id?: string | number })?.id ?? null;
        send(makeError(id, ERR_INTERNAL, "Internal error", String(e)));
      });
  });
  rl.on("close", () => opts.onClose?.());
  opts.log?.("[skill-mcp] stdio transport ready");
}
