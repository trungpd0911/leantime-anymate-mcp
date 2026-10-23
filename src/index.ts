#!/usr/bin/env node
/**
 * leantime-anymate-mcp
 *
 * MCP server for managing AnyMate's Leantime: projects, sprints, tasks, assignees
 * and statuses. AI-free and deterministic: the agent writes headlines/descriptions;
 * this server only calls the Leantime JSON-RPC API.
 *
 * Transport: stdio (local). Config via env: LEANTIME_BASE_URL, LEANTIME_API_KEY,
 * (optional) LEANTIME_USER_ID, LEANTIME_PICK_LIMIT.
 */
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

// Load .env (from DOTENV_CONFIG_PATH, else the cwd) for dev/testing; never overrides
// config-provided env. `quiet` is required: dotenv 17 logs to stdout, which is the
// MCP stdio channel and would corrupt the JSON-RPC stream.
config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

async function main(): Promise<void> {
  const server = new McpServer({ name: "leantime-anymate-mcp", version: "1.1.0" });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Leantime env is validated lazily per-call so the server starts without it.
  console.error("leantime-anymate-mcp running via stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
