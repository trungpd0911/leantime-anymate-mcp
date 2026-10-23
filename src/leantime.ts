/**
 * Minimal Leantime JSON-RPC client. Ported from ai-git-fish (leantime/src/leantime.ts).
 *
 * One endpoint: POST {BASE}/api/jsonrpc, authenticated via the `x-api-key` header.
 * Method signatures were checked against Leantime v3.5.4 source.
 */
import { leantimeConfig } from "./constants.js";

export interface LeantimeTicket {
  id: number | string;
  headline: string;
  description?: string;
  type?: string;
  status?: string | number;
  priority?: string | number | null;
  projectId?: string | number;
  projectName?: string;
  sprint?: string | number | null;
  sprintName?: string | null;
  editorId?: string | number | null;
  editorFirstname?: string | null;
  editorLastname?: string | null;
  dateToFinish?: string | null;
  editFrom?: string | null;
  planHours?: string | number | null;
  [k: string]: unknown;
}

export interface LeantimeUser {
  id: number | string;
  firstname?: string;
  lastname?: string;
  username?: string;
  [k: string]: unknown;
}

export interface LeantimeProject {
  id: number | string;
  name: string;
  [k: string]: unknown;
}

export interface LeantimeSprint {
  id: number | string;
  name: string;
  projectId: number | string;
  startDate?: string;
  endDate?: string;
  [k: string]: unknown;
}

export interface LeantimeStatusLabel {
  name: string;
  statusType?: string;
  [k: string]: unknown;
}

/** One JSON-RPC call to Leantime. Throws on transport/HTTP/RPC error. */
async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const { baseUrl, apiKey } = leantimeConfig();

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/jsonrpc`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!res.ok) {
    throw new Error(`Leantime HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error) {
    throw new Error(`Leantime RPC error: ${JSON.stringify(json.error)}`);
  }
  return json.result as T;
}

/**
 * Leantime services report validation failures as a `{ msg, type: "error" }` result
 * (or `false`) instead of an RPC error — turn those into exceptions.
 */
function assertWriteOk(method: string, result: unknown): void {
  if (result === false || result == null) {
    throw new Error(`Leantime ${method} failed (no access or not found)`);
  }
  if (typeof result === "object" && !Array.isArray(result) && "msg" in result) {
    throw new Error(`Leantime ${method} failed: ${String((result as { msg: unknown }).msg)}`);
  }
}

/** Accept `5`, `"5"` or `[5]` — ai-git-fish saw addTicket's id wrapped in an array. */
function idFrom(result: unknown): number {
  const raw = Array.isArray(result) ? result[0] : result;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Leantime returned an unexpected id: ${JSON.stringify(result)}`);
  }
  return id;
}

/** Fetch every ticket visible to the API key. */
export async function fetchAllTickets(): Promise<LeantimeTicket[]> {
  return (await rpc<LeantimeTicket[]>("leantime.rpc.tickets.tickets.getAll")) ?? [];
}

/** Fetch a single ticket by id, or null if not found. */
export async function fetchTicket(id: string | number): Promise<LeantimeTicket | null> {
  const all = await fetchAllTickets();
  return all.find((t) => String(t.id) === String(id)) ?? null;
}

/**
 * Fetch the instance's status-id → label map (e.g. { "3": { name: "New", statusType: "NEW" } }).
 * Status ids are configurable per Leantime instance — never hardcode them.
 */
export async function fetchStatusLabels(): Promise<Record<string, LeantimeStatusLabel>> {
  return (await rpc<Record<string, LeantimeStatusLabel>>(
    "leantime.rpc.tickets.tickets.getStatusLabels"
  )) ?? {};
}

export async function fetchProjects(): Promise<LeantimeProject[]> {
  return (await rpc<LeantimeProject[]>("leantime.rpc.projects.projects.getAll")) ?? [];
}

export async function fetchAllSprints(): Promise<LeantimeSprint[]> {
  return (await rpc<LeantimeSprint[]>("leantime.rpc.sprints.sprints.getAllSprints")) ?? [];
}

/**
 * Fetch users. Tries a few known method names so it survives minor Leantime
 * version differences.
 */
export async function fetchUsers(): Promise<LeantimeUser[]> {
  const methods = [
    "leantime.rpc.users.users.getAll",
    "leantime.rpc.users.getAll",
    "leantime.rpc.users.users.getAllUsers",
  ];
  let lastErr: unknown;
  for (const m of methods) {
    try {
      const out = await rpc<LeantimeUser[]>(m);
      if (Array.isArray(out)) return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("no users method succeeded");
}

export interface NewTicketValues {
  headline: string;
  projectId: number | string;
  editorId?: number | string;
  type?: string;
  description?: string;
  priority?: number | string;
  status?: number | string;
  sprint?: number | string;
  dateToFinish?: string;
  editFrom?: string;
  planHours?: number;
}

/** Create a ticket and return its new id. */
export async function createTicket(values: NewTicketValues): Promise<number> {
  const result = await rpc<unknown>("leantime.rpc.tickets.tickets.addTicket", { values });
  assertWriteOk("addTicket", result);
  return idFrom(result);
}

/**
 * Partially update a ticket. Uses `patch`, not `updateTicket`: in v3.5.4
 * `updateTicket` rewrites every column and blanks any field not sent (description,
 * assignee, sprint, ...). `patch` only touches the given keys and needs no projectId.
 */
export async function patchTicket(id: number | string, params: Record<string, unknown>): Promise<void> {
  const result = await rpc<unknown>("leantime.rpc.tickets.tickets.patch", { id, params });
  assertWriteOk("patch", result);
}

export interface NewSprintValues {
  name: string;
  projectId: number | string;
  startDate: string;
  endDate: string;
}

/**
 * Create a sprint and return its id. v3.5.4: `addSprint($params)` reads
 * name/projectId/startDate/endDate; dates accept `YYYY-MM-DD` (parsed in the API
 * user's timezone, start/end of day).
 */
export async function createSprint(values: NewSprintValues): Promise<number> {
  const result = await rpc<unknown>("leantime.rpc.sprints.sprints.addSprint", { params: values });
  assertWriteOk("addSprint", result);
  return idFrom(result);
}
