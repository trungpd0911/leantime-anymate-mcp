#!/usr/bin/env node
/**
 * leantime-anymate-mcp
 *
 * MCP server for managing AnyMate's Leantime: projects, sprints, tasks, assignees
 * and statuses. AI-free and deterministic: the agent writes headlines/descriptions;
 * this server only calls the Leantime JSON-RPC API.
 *
 * Transport: stdio (default, local) or Streamable HTTP (`--http` or
 * MCP_TRANSPORT=http, for remote clients like claude.ai). Config via env:
 * LEANTIME_BASE_URL, LEANTIME_API_KEY, (optional) LEANTIME_USER_ID, LEANTIME_PICK_LIMIT;
 * HTTP also needs MCP_AUTH_TOKEN and optionally PORT / HOST.
 */
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { createHttpServer, httpOptionsFromEnv } from "./http.js";
import { registerTools } from "./tools.js";

// Load .env (from DOTENV_CONFIG_PATH, else the cwd) for dev/testing; never overrides
// config-provided env. `quiet` is required: dotenv 17 logs to stdout, which is the
// MCP stdio channel and would corrupt the JSON-RPC stream.
config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

async function runStdio(): Promise<void> {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Leantime env is validated lazily per-call so the server starts without it.
  console.error("leantime-anymate-mcp running via stdio");
}

function runHttp(): void {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "0.0.0.0";
  createHttpServer(httpOptionsFromEnv()).listen(port, host, () => {
    console.error(`leantime-anymate-mcp running via HTTP on ${host}:${port} (POST /mcp)`);
  });
}

async function main(): Promise<void> {
  const useHttp = process.argv.includes("--http") || process.env.MCP_TRANSPORT === "http";
  if (useHttp) runHttp();
  else await runStdio();
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
