import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, httpOptionsFromEnv } from "../src/http.js";

const TOKEN = "t".repeat(40);
let server: Server;
let base: string;

beforeAll(async () => {
  server = createHttpServer({ authToken: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function listTools(url: string, headers?: Record<string, string>): Promise<string[]> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name);
}

describe("http transport", () => {
  it("serves tools with the token in the path", async () => {
    const names = await listTools(`${base}/mcp/${TOKEN}`);
    expect(names).toContain("leantime_list_tasks");
  });

  it("serves tools with a bearer token", async () => {
    const names = await listTools(`${base}/mcp`, { Authorization: `Bearer ${TOKEN}` });
    expect(names).toContain("leantime_create_task");
  });

  it("rejects a missing or wrong token", async () => {
    const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
    expect((await fetch(`${base}/mcp`, init)).status).toBe(401);
    expect((await fetch(`${base}/mcp/wrong`, init)).status).toBe(401);
    expect((await fetch(`${base}/mcp`, { ...init, headers: { ...init.headers, Authorization: "Bearer wrong" } })).status).toBe(401);
  });

  it("answers health and 404", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it("rejects GET on the MCP endpoint", async () => {
    expect((await fetch(`${base}/mcp/${TOKEN}`)).status).toBe(405);
  });

  it("refuses to start without a strong token", () => {
    const prev = process.env.MCP_AUTH_TOKEN;
    process.env.MCP_AUTH_TOKEN = "short";
    expect(() => httpOptionsFromEnv()).toThrow(/MCP_AUTH_TOKEN/);
    delete process.env.MCP_AUTH_TOKEN;
    expect(() => httpOptionsFromEnv()).toThrow(/MCP_AUTH_TOKEN/);
    if (prev !== undefined) process.env.MCP_AUTH_TOKEN = prev;
  });
});
