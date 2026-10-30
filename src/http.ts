/**
 * Streamable HTTP transport, for remote clients such as claude.ai custom connectors.
 *
 * Stateless: every POST gets a fresh McpServer + transport, so no session state is
 * kept between requests. Every request must carry the shared secret MCP_AUTH_TOKEN,
 * either in the path (`/mcp/<token>`, for clients that cannot send custom headers,
 * like claude.ai) or as `Authorization: Bearer <token>` on `/mcp`.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerTools } from "./tools.js";

/** Minimum token length, so a guessable secret is refused at startup. */
export const MIN_AUTH_TOKEN_LENGTH = 32;

export interface HttpOptions {
  authToken: string;
}

/** Read HTTP options from env; throws when the auth token is missing or too short. */
export function httpOptionsFromEnv(): HttpOptions {
  const authToken = process.env.MCP_AUTH_TOKEN ?? "";
  if (authToken.length < MIN_AUTH_TOKEN_LENGTH) {
    throw new Error(
      `MCP_AUTH_TOKEN must be set to a random secret of at least ${MIN_AUTH_TOKEN_LENGTH} characters ` +
        "(e.g. `openssl rand -hex 32`) to run the HTTP transport."
    );
  }
  return { authToken };
}

/** Constant-time string comparison (hashing first makes the lengths equal). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Return true when the request carries the token, in the path or as a bearer header. */
function isAuthorized(req: IncomingMessage, pathname: string, authToken: string): boolean {
  if (pathname.startsWith("/mcp/")) {
    return safeEqual(decodeURIComponent(pathname.slice("/mcp/".length)), authToken);
  }
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match !== null && safeEqual(match[1].trim(), authToken);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Stateless mode has no server-initiated stream or session to delete.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    rpcError(res, 405, "Method not allowed.");
    return;
  }
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Build (but do not start) the HTTP server. */
export function createHttpServer(options: HttpOptions): Server {
  return createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");

    if (pathname === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }
    if (pathname !== "/mcp" && !pathname.startsWith("/mcp/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    if (!isAuthorized(req, pathname, options.authToken)) {
      rpcError(res, 401, "Unauthorized.");
      return;
    }

    handleMcp(req, res).catch((error) => {
      console.error("MCP request failed:", error);
      if (!res.headersSent) rpcError(res, 500, "Internal server error.");
    });
  });
}
