// Skill-MCP 启动入口：node src/main.ts [--skills-dir ..] [--data-dir ..] [--config ..]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSkillMcp } from "./server.ts";
import { startStdio } from "./protocol/stdio.ts";
import { startHttpTransport } from "./protocol/http.ts";

function parseArgs(argv: string[]): { skillsDir: string; dataDir: string; configPath: string | null; http: boolean; port: number; host: string } {
  const out = { skillsDir: join(process.cwd(), "skills"), dataDir: join(process.cwd(), "data"), configPath: null as string | null, http: false, port: 0, host: "127.0.0.1" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if ((a === "--skills-dir" || a === "--data-dir" || a === "--config") && next) {
      if (a === "--skills-dir") out.skillsDir = next;
      if (a === "--data-dir") out.dataDir = next;
      if (a === "--config") out.configPath = next;
      i++;
    } else if (a === "--http") {
      out.http = true;
    } else if (a === "--port" && next) {
      out.port = Number(next) || 0;
      i++;
    } else if (a === "--host" && next) {
      out.host = next;
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log("skill-mcp: skills as data.\nUsage: node src/main.ts [--skills-dir DIR] [--data-dir DIR] [--config FILE] [--http] [--port N] [--host H]\nDefaults: skills/ and data/ under cwd. Speaks MCP over stdio (or HTTP when --http).");
      process.exit(0);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let config: Record<string, unknown> = {};
  if (args.configPath) {
    try { config = JSON.parse(readFileSync(args.configPath, "utf8")) as Record<string, unknown>; }
    catch { /* 配置缺失或损坏时不阻塞启动 */ }
  }
  const created = await createSkillMcp({
    skillsDir: args.skillsDir,
    dataDir: args.dataDir,
    policy: (config.policy as never) ?? undefined,
    embedConfig: (config.embedder as never) ?? undefined,
    llmConfig: (config.llm as never) ?? undefined,
    reranker: (config.reranker as "heuristic" | "llm") ?? "heuristic",
    trust: (config.trust as never) ?? undefined,
    gate: (config.gate as never) ?? undefined,
    remotes: (config.remotes as never) ?? undefined,
  });
  if (args.http) {
    const transport = startHttpTransport({
      server: created.server,
      port: args.port,
      host: args.host,
      log: (line) => process.stderr.write(line + "\n"),
    });
    const port = await transport.listen();
    process.stderr.write("[skill-mcp] HTTP transport listening on http://" + args.host + ":" + port + "/mcp\n");
  } else {
    startStdio({
      server: created.server,
      log: (line) => process.stderr.write(line + "\n"),
    });
  }
}

main().catch((e) => {
  process.stderr.write("fatal: " + String(e && (e as Error).stack ? (e as Error).stack : e) + "\n");
  process.exit(1);
});
