import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/tools.js";

const BASE = "https://leantime.test";

const STATUSES = {
  "3": { name: "New", statusType: "NEW" },
  "1": { name: "Blocked", statusType: "INPROGRESS" },
  "4": { name: "In Progress", statusType: "INPROGRESS" },
  "2": { name: "Waiting for Approval", statusType: "INPROGRESS" },
  "0": { name: "Done", statusType: "DONE" },
  "-1": { name: "Archived", statusType: "DONE" },
  "5": { name: "Q&A", statusType: "INPROGRESS" },
  "6": { name: "Confirmed", statusType: "INPROGRESS" },
};

const TICKETS = [
  { id: 10, headline: "Login page", status: 4, projectId: 1, projectName: "Web", sprint: 7, sprintName: "S7", editorId: 5, editorFirstname: "An", priority: 2, type: "task", dateToFinish: "2026-11-01 23:59:59", editFrom: "2026-10-01 00:00:00", planHours: "3", description: "<p>Build &amp; ship</p>" },
  { id: 11, headline: "Old bug", status: 0, projectId: 1, projectName: "Web", sprint: 7, editorId: 5, type: "bug" },
  { id: 12, headline: "Archived thing", status: -1, projectId: 1, sprint: 0, editorId: 6 },
  { id: 13, headline: "Other project", status: 3, projectId: 2, sprint: 8, editorId: 5 },
];

const SPRINTS = [
  { id: 7, name: "S7", projectId: 1, startDate: "2026-10-01 00:00:00", endDate: "2026-10-14 23:59:59" },
  { id: 9, name: "S9", projectId: 1, startDate: "2026-10-15 00:00:00", endDate: "2026-10-28 23:59:59" },
  { id: 8, name: "S8", projectId: 2, startDate: "2026-10-01 00:00:00", endDate: "2026-10-14 23:59:59" },
];

type RpcCall = { method: string; params: Record<string, any> };
let calls: RpcCall[];
let overrides: Record<string, unknown>;

/** Route JSON-RPC calls by method name; `overrides` lets a test change one result. */
function mockFetch() {
  return vi.fn(async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    const results: Record<string, unknown> = {
      "leantime.rpc.tickets.tickets.getStatusLabels": STATUSES,
      "leantime.rpc.tickets.tickets.getAll": TICKETS,
      "leantime.rpc.sprints.sprints.getAllSprints": SPRINTS,
      "leantime.rpc.projects.projects.getAll": [{ id: 2, name: "Mobile" }, { id: 1, name: "Web" }],
      "leantime.rpc.users.users.getAll": [{ id: 5, firstname: "An", lastname: "Le", username: "an@x.test" }],
      "leantime.rpc.tickets.tickets.addTicket": 99,
      "leantime.rpc.tickets.tickets.patch": true,
      "leantime.rpc.sprints.sprints.addSprint": 42,
      ...overrides,
    };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: results[body.method] }), { status: 200 });
  });
}

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const client = await connect();
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = res.content[0].text;
  return { isError: !!res.isError, text, data: res.isError ? null : JSON.parse(text) };
}

function lastWrite(): RpcCall {
  return calls.filter((c) => /addTicket|patch|addSprint/.test(c.method)).at(-1)!;
}

beforeEach(() => {
  calls = [];
  overrides = {};
  vi.stubEnv("LEANTIME_BASE_URL", BASE);
  vi.stubEnv("LEANTIME_API_KEY", "test-key");
  vi.stubEnv("LEANTIME_USER_ID", "5");
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ALL_TOOLS: [string, Record<string, unknown>][] = [
  ["leantime_list_projects", {}],
  ["leantime_list_users", {}],
  ["leantime_list_sprints", {}],
  ["leantime_list_statuses", {}],
  ["leantime_list_tasks", {}],
  ["leantime_get_task", { id: 10 }],
  ["leantime_create_sprint", { project_id: 1, name: "S10", start_date: "2026-10-29", end_date: "2026-11-11" }],
  ["leantime_create_task", { project_id: 1, headline: "New thing" }],
  ["leantime_assign_task", { task_id: 10, assignee_id: 6 }],
  ["leantime_set_task_status", { task_id: 10, status: "Done" }],
  ["leantime_update_task", { task_id: 10, headline: "Renamed" }],
];

describe("missing env", () => {
  it.each(ALL_TOOLS)("%s returns an actionable error without calling Leantime", async (name, args) => {
    vi.stubEnv("LEANTIME_BASE_URL", "");
    vi.stubEnv("LEANTIME_API_KEY", "");
    const res = await call(name, args);
    expect(res.isError).toBe(true);
    expect(res.text).toContain("LEANTIME_BASE_URL and LEANTIME_API_KEY");
    expect(calls).toHaveLength(0);
  });
});

describe("read tools", () => {
  it("sends the API key header to the JSON-RPC endpoint", async () => {
    await call("leantime_list_projects");
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe(`${BASE}/api/jsonrpc`);
    expect(init.headers["x-api-key"]).toBe("test-key");
  });

  it("leantime_list_projects sorts by name", async () => {
    const { data } = await call("leantime_list_projects");
    expect(data.projects.map((p: any) => p.name)).toEqual(["Mobile", "Web"]);
  });

  it("leantime_list_users marks the configured user", async () => {
    const { data } = await call("leantime_list_users");
    expect(data.users[0]).toMatchObject({ id: 5, name: "An Le", isConfigured: true });
  });

  it("leantime_list_sprints filters by project, newest first", async () => {
    const { data } = await call("leantime_list_sprints", { project_id: 1 });
    expect(data.sprints.map((s: any) => s.id)).toEqual([9, 7]);
    expect(data.sprints[0]).toMatchObject({ startDate: "2026-10-15", endDate: "2026-10-28" });
  });

  it("leantime_list_statuses returns id, name, statusType", async () => {
    const { data } = await call("leantime_list_statuses");
    expect(data.count).toBe(8);
    expect(data.statuses).toContainEqual({ id: "5", name: "Q&A", statusType: "INPROGRESS" });
  });

  it("leantime_list_tasks returns all tasks newest first", async () => {
    const { data } = await call("leantime_list_tasks");
    expect(data.tasks.map((t: any) => t.id)).toEqual([13, 12, 11, 10]);
  });

  it("leantime_list_tasks exclude_done drops Done and Archived", async () => {
    const { data } = await call("leantime_list_tasks", { exclude_done: true });
    expect(data.tasks.map((t: any) => t.id)).toEqual([13, 10]);
  });

  it("leantime_list_tasks combines assignee, project, sprint filters", async () => {
    const { data } = await call("leantime_list_tasks", { assignee_id: 5, project_id: 1, sprint_id: 7 });
    expect(data.tasks.map((t: any) => t.id)).toEqual([11, 10]);
  });

  it("leantime_list_tasks filters by status name case-insensitively", async () => {
    const { data } = await call("leantime_list_tasks", { status: "in progress" });
    expect(data.tasks.map((t: any) => t.id)).toEqual([10]);
  });

  it("leantime_list_tasks rejects an unknown status with the valid names", async () => {
    const res = await call("leantime_list_tasks", { status: "Doing" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('"Waiting for Approval"');
  });

  it("leantime_list_tasks applies limit and reports total", async () => {
    const { data } = await call("leantime_list_tasks", { limit: 1 });
    expect(data).toMatchObject({ total: 4, count: 1 });
  });

  it("leantime_get_task returns formatted detail", async () => {
    const { data } = await call("leantime_get_task", { id: "10" });
    expect(data).toMatchObject({
      found: true,
      status: "In Progress",
      priority: "High",
      sprintName: "S7",
      assigneeId: 5,
      dueDate: "2026-11-01",
      startDate: "2026-10-01",
      plannedHours: 3,
      description: "Build & ship",
      url: `${BASE}/#/tickets/showTicket/10`,
    });
  });

  it("leantime_get_task keeps image URLs as [image: ...] markers", async () => {
    overrides["leantime.rpc.tickets.tickets.getAll"] = [
      {
        id: 20,
        headline: "With images",
        status: 3,
        description:
          '<p>See below</p><p><img src="/files/get?module=ticket&amp;id=7" alt="x"></p><p><img alt="y" src="https://cdn.test/a.png"></p>',
      },
      { id: 21, headline: "Image only", status: 3, description: '<p><img src="/files/get?id=9"></p>' },
    ];
    const withText = await call("leantime_get_task", { id: 20 });
    expect(withText.data.description).toBe(
      `See below\n[image: ${BASE}/files/get?module=ticket&id=7]\n\n[image: https://cdn.test/a.png]`,
    );
    const imageOnly = await call("leantime_get_task", { id: 21 });
    expect(imageOnly.data.description).toBe(`[image: ${BASE}/files/get?id=9]`);
  });

  it("leantime_get_task reports a missing task", async () => {
    const { data } = await call("leantime_get_task", { id: 404 });
    expect(data).toEqual({ found: false, id: 404 });
  });
});

describe("write tools", () => {
  it("leantime_create_sprint calls addSprint with params", async () => {
    const { data } = await call("leantime_create_sprint", {
      project_id: 1, name: "S10", start_date: "2026-10-29", end_date: "2026-11-11",
    });
    expect(data.id).toBe(42);
    expect(lastWrite()).toEqual({
      method: "leantime.rpc.sprints.sprints.addSprint",
      params: { params: { name: "S10", projectId: 1, startDate: "2026-10-29", endDate: "2026-11-11" } },
    });
  });

  it("leantime_create_sprint rejects end before start", async () => {
    const res = await call("leantime_create_sprint", {
      project_id: 1, name: "S10", start_date: "2026-11-11", end_date: "2026-10-29",
    });
    expect(res.isError).toBe(true);
    expect(calls.some((c) => c.method.endsWith("addSprint"))).toBe(false);
  });

  it("leantime_create_sprint rejects non-ISO dates", async () => {
    const res = await call("leantime_create_sprint", {
      project_id: 1, name: "S10", start_date: "10/29/2026", end_date: "2026-11-11",
    });
    expect(res.isError).toBe(true);
  });

  it("leantime_create_task defaults to status New and sends optional fields", async () => {
    const { data } = await call("leantime_create_task", {
      project_id: 1, headline: "New thing", sprint_id: 7, assignee_id: 5, priority: 3, due_date: "2026-11-05",
      start_date: "2026-10-01", planned_hours: 3,
    });
    expect(data).toMatchObject({ id: 99, status: "New", assigneeId: 5 });
    expect(lastWrite().params.values).toEqual({
      headline: "New thing", projectId: 1, type: "task", status: "3",
      editorId: 5, sprint: 7, priority: 3, dateToFinish: "2026-11-05", editFrom: "2026-10-01", planHours: 3,
    });
  });

  it("leantime_create_task without assignee leaves it unassigned", async () => {
    const { data } = await call("leantime_create_task", { project_id: 1, headline: "Unassigned" });
    expect(data.assigneeId).toBeNull();
    expect(lastWrite().params.values).not.toHaveProperty("editorId");
  });

  it("leantime_create_task accepts an id wrapped in an array", async () => {
    overrides["leantime.rpc.tickets.tickets.addTicket"] = [100];
    const { data } = await call("leantime_create_task", { project_id: 1, headline: "X" });
    expect(data.id).toBe(100);
  });

  it("leantime_create_task surfaces Leantime validation errors", async () => {
    overrides["leantime.rpc.tickets.tickets.addTicket"] = { msg: "notifications.ticket_save_error_no_access", type: "error" };
    const res = await call("leantime_create_task", { project_id: 1, headline: "X" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("ticket_save_error_no_access");
  });

  it("leantime_assign_task patches only editorId", async () => {
    const { data } = await call("leantime_assign_task", { task_id: 10, assignee_id: 6 });
    expect(data.assigneeId).toBe(6);
    expect(lastWrite()).toEqual({
      method: "leantime.rpc.tickets.tickets.patch",
      params: { id: 10, params: { editorId: 6 } },
    });
  });

  it("leantime_assign_task reports a failed patch", async () => {
    overrides["leantime.rpc.tickets.tickets.patch"] = false;
    const res = await call("leantime_assign_task", { task_id: 404, assignee_id: 6 });
    expect(res.isError).toBe(true);
  });

  it("leantime_set_task_status resolves the name to its id", async () => {
    const { data } = await call("leantime_set_task_status", { task_id: 10, status: "waiting for approval" });
    expect(data).toMatchObject({ status: "Waiting for Approval", statusId: "2" });
    expect(lastWrite().params).toEqual({ id: 10, params: { status: "2" } });
  });

  it("leantime_set_task_status rejects unknown names without writing", async () => {
    const res = await call("leantime_set_task_status", { task_id: 10, status: "Doing" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('"Q&A"');
    expect(calls.some((c) => c.method.endsWith("patch"))).toBe(false);
  });

  it("leantime_update_task patches only the given fields", async () => {
    const { data } = await call("leantime_update_task", { task_id: 10, headline: "Renamed", due_date: "2026-12-01", sprint_id: 9 });
    expect(data.updated).toEqual(["headline", "dateToFinish", "sprint"]);
    expect(lastWrite().params).toEqual({
      id: 10,
      params: { headline: "Renamed", dateToFinish: "2026-12-01", sprint: 9 },
    });
  });

  it("leantime_update_task patches start date and planned hours", async () => {
    const { data } = await call("leantime_update_task", { task_id: 10, start_date: "2026-10-01", planned_hours: 3 });
    expect(data.updated).toEqual(["editFrom", "planHours"]);
    expect(lastWrite().params).toEqual({ id: 10, params: { editFrom: "2026-10-01", planHours: 3 } });
  });

  it("leantime_get_task reports no start date or hours when unset", async () => {
    const { data } = await call("leantime_get_task", { id: 13 });
    expect(data).toMatchObject({ startDate: "—", plannedHours: null });
  });

  it("leantime_update_task with no fields errors without writing", async () => {
    const res = await call("leantime_update_task", { task_id: 10 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Nothing to update");
    expect(calls).toHaveLength(0);
  });
});
