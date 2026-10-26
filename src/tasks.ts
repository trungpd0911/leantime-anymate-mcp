/**
 * Task, sprint, project and user logic on top of the JSON-RPC client.
 *
 * HTML stripping and entity decoding are ported from ai-git-mcp (src/tickets.ts).
 */
import { configuredPickLimit, leantimeConfig } from "./constants.js";
import {
  createSprint as rpcCreateSprint,
  createTicket,
  fetchAllSprints,
  fetchAllTickets,
  fetchProjects,
  fetchStatusLabels,
  fetchTicket,
  fetchUsers,
  patchTicket,
  type LeantimeTicket,
} from "./leantime.js";

/** Status names treated as finished by `exclude_done` (confirmed with the user). */
const DONE_STATUS_NAMES = ["done", "archived"];

/** Leantime's built-in priority scale. */
const PRIORITY_LABELS: Record<string, string> = {
  "1": "Critical",
  "2": "High",
  "3": "Medium",
  "4": "Low",
  "5": "Lowest",
};

// Common named HTML entities seen in Leantime descriptions (incl. Vietnamese).
// &amp; is decoded last so "&amp;lt;" stays literal.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  agrave: "à", aacute: "á", egrave: "è", eacute: "é",
  igrave: "ì", iacute: "í", ograve: "ò", oacute: "ó",
  ocirc: "ô", ugrave: "ù", uacute: "ú",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&amp;/gi, "&");
}

export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Replace each <img> with an "[image: <absolute url>]" marker so stripHtml() doesn't drop it. */
function markImages(html: string): string {
  const { baseUrl } = leantimeConfig();
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const url = decodeEntities(src?.[1] ?? src?.[2] ?? "").trim();
    if (!url) return "";
    return `\n[image: ${new URL(url, `${baseUrl.replace(/\/$/, "")}/`).href}]\n`;
  });
}

function isZeroDate(s?: string | null): boolean {
  return !s || s.startsWith("0000-00-00");
}

function fmtDate(s?: string | null): string {
  return isZeroDate(s) ? "—" : String(s).split(" ")[0];
}

function ticketUrl(id: string | number): string {
  const { baseUrl } = leantimeConfig();
  return `${baseUrl.replace(/\/$/, "")}/#/tickets/showTicket/${id}`;
}

function oneLine(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function isSet(v: unknown): boolean {
  return v != null && String(v).trim() !== "" && String(v) !== "0";
}

// -- Statuses ---------------------------------------------------------------

export interface StatusSummary {
  id: string;
  name: string;
  statusType: string | null;
}

export async function listStatuses(): Promise<StatusSummary[]> {
  const raw = await fetchStatusLabels();
  return Object.entries(raw)
    .map(([id, def]) => ({ id, name: String(def?.name ?? `status ${id}`), statusType: def?.statusType ?? null }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/** Resolve a status name (case-insensitive) to its id, or throw listing the valid names. */
export function resolveStatus(name: string, statuses: StatusSummary[]): StatusSummary {
  const wanted = name.trim().toLowerCase();
  const hit = statuses.find((s) => s.name.toLowerCase() === wanted);
  if (!hit) {
    const valid = statuses.map((s) => `"${s.name}"`).join(", ");
    throw new Error(`Unknown status "${name}". Valid statuses on this instance: ${valid}`);
  }
  return hit;
}

// -- Projects, users, sprints -----------------------------------------------

export interface ProjectSummary {
  id: string | number;
  name: string;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const projects = await fetchProjects();
  return projects
    .map((p) => ({ id: p.id, name: oneLine(p.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface UserSummary {
  id: string | number;
  name: string;
  username: string;
  isConfigured: boolean;
}

/** List users; marks the one set in LEANTIME_USER_ID (if any) with `isConfigured`. */
export async function listUsers(): Promise<UserSummary[]> {
  const me = process.env.LEANTIME_USER_ID;
  const users = await fetchUsers();
  return users
    .map((u) => ({
      id: u.id,
      name: [u.firstname, u.lastname].filter(Boolean).join(" ").trim() || `user ${u.id}`,
      username: String(u.username ?? ""),
      isConfigured: me != null && String(u.id) === String(me),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SprintSummary {
  id: string | number;
  name: string;
  projectId: string | number;
  startDate: string;
  endDate: string;
}

/** Sprints, optionally for one project, newest start date first. */
export async function listSprints(projectId?: string | number): Promise<SprintSummary[]> {
  let sprints = await fetchAllSprints();
  if (isSet(projectId)) sprints = sprints.filter((s) => String(s.projectId) === String(projectId));
  return sprints
    .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")))
    .map((s) => ({
      id: s.id,
      name: oneLine(s.name),
      projectId: s.projectId,
      startDate: fmtDate(s.startDate),
      endDate: fmtDate(s.endDate),
    }));
}

export interface CreateSprintInput {
  projectId: string | number;
  name: string;
  startDate: string;
  endDate: string;
}

export async function createSprint(input: CreateSprintInput): Promise<SprintSummary> {
  if (input.endDate < input.startDate) {
    throw new Error(`end_date (${input.endDate}) is before start_date (${input.startDate})`);
  }
  const id = await rpcCreateSprint({
    name: input.name,
    projectId: input.projectId,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  return { id, ...input };
}

// -- Tasks ------------------------------------------------------------------

/** Max length of the description snippet shown in list results. */
const SNIPPET_MAX = 200;

export interface TaskSummary {
  id: string | number;
  headline: string;
  type: string;
  status: string;
  priority: string;
  projectId: string | number | null;
  projectName: string;
  sprintId: string | number | null;
  sprintName: string;
  assigneeId: string | number | null;
  assignee: string;
  dueDate: string;
  startDate: string;
  plannedHours: number | null;
  url: string;
  description: string;
}

function statusName(t: LeantimeTicket, statuses: StatusSummary[]): string {
  const raw = String(t.status ?? "");
  return statuses.find((s) => s.id === raw)?.name ?? (raw ? `status ${raw}` : "unknown");
}

function summarize(t: LeantimeTicket, statuses: StatusSummary[], fullDescription = false): TaskSummary {
  const desc = stripHtml(markImages(String(t.description ?? "")));
  return {
    id: t.id,
    headline: oneLine(t.headline),
    type: String(t.type ?? "task"),
    status: statusName(t, statuses),
    priority: PRIORITY_LABELS[String(t.priority ?? "")] ?? "—",
    projectId: t.projectId ?? null,
    projectName: String(t.projectName ?? "—"),
    sprintId: isSet(t.sprint) ? (t.sprint as string | number) : null,
    sprintName: String(t.sprintName ?? "") || "—",
    assigneeId: isSet(t.editorId) ? (t.editorId as string | number) : null,
    assignee: [t.editorFirstname, t.editorLastname].filter(Boolean).join(" ") || "—",
    dueDate: fmtDate(t.dateToFinish),
    startDate: fmtDate(t.editFrom),
    plannedHours: Number(t.planHours) > 0 ? Number(t.planHours) : null,
    url: ticketUrl(t.id),
    description: fullDescription || desc.length <= SNIPPET_MAX ? desc : `${desc.slice(0, SNIPPET_MAX)}…`,
  };
}

export interface ListTasksFilter {
  assigneeId?: string | number;
  projectId?: string | number;
  sprintId?: string | number;
  status?: string;
  excludeDone?: boolean;
  limit?: number;
}

export interface ListTasksResult {
  total: number;
  tasks: TaskSummary[];
}

/** Filter all tickets client-side (getAll has no server filters we rely on), newest id first. */
export async function listTasks(filter: ListTasksFilter): Promise<ListTasksResult> {
  const cap = filter.limit ?? configuredPickLimit();
  const [statuses, all] = await Promise.all([listStatuses(), fetchAllTickets()]);

  let tickets = all;
  if (isSet(filter.assigneeId)) tickets = tickets.filter((t) => String(t.editorId) === String(filter.assigneeId));
  if (isSet(filter.projectId)) tickets = tickets.filter((t) => String(t.projectId) === String(filter.projectId));
  if (isSet(filter.sprintId)) tickets = tickets.filter((t) => String(t.sprint) === String(filter.sprintId));
  if (filter.status) {
    const wanted = resolveStatus(filter.status, statuses);
    tickets = tickets.filter((t) => String(t.status) === wanted.id);
  }
  if (filter.excludeDone) {
    const doneIds = new Set(
      statuses.filter((s) => DONE_STATUS_NAMES.includes(s.name.toLowerCase())).map((s) => s.id)
    );
    tickets = tickets.filter((t) => !doneIds.has(String(t.status)));
  }

  tickets.sort((a, b) => Number(b.id) - Number(a.id));
  return { total: tickets.length, tasks: tickets.slice(0, cap).map((t) => summarize(t, statuses)) };
}

/** Full detail for one task, or null if missing. */
export async function getTask(id: string | number): Promise<TaskSummary | null> {
  const [statuses, t] = await Promise.all([listStatuses(), fetchTicket(id)]);
  return t ? summarize(t, statuses, true) : null;
}

export interface CreateTaskInput {
  projectId: string | number;
  headline: string;
  sprintId?: string | number;
  assigneeId?: string | number;
  description?: string;
  priority?: number;
  type?: string;
  dueDate?: string;
  startDate?: string;
  plannedHours?: number;
}

export interface CreateTaskResult {
  id: number;
  headline: string;
  status: string;
  assigneeId: string | number | null;
  url: string;
}

/** Create a task with status "New" (looked up by name; Leantime's default if absent). */
export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  const statuses = await listStatuses();
  const newStatus = statuses.find((s) => s.name.toLowerCase() === "new");

  const id = await createTicket({
    headline: input.headline,
    projectId: input.projectId,
    type: input.type ?? "task",
    ...(newStatus ? { status: newStatus.id } : {}),
    ...(isSet(input.assigneeId) ? { editorId: input.assigneeId } : {}),
    ...(isSet(input.sprintId) ? { sprint: input.sprintId } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.dueDate ? { dateToFinish: input.dueDate } : {}),
    ...(input.startDate ? { editFrom: input.startDate } : {}),
    ...(input.plannedHours !== undefined ? { planHours: input.plannedHours } : {}),
  });

  return {
    id,
    headline: input.headline,
    status: newStatus?.name ?? "Leantime default",
    assigneeId: isSet(input.assigneeId) ? input.assigneeId! : null,
    url: ticketUrl(id),
  };
}

export async function assignTask(id: string | number, assigneeId: string | number) {
  await patchTicket(id, { editorId: assigneeId });
  return { id, assigneeId, url: ticketUrl(id) };
}

export async function setTaskStatus(id: string | number, status: string) {
  const resolved = resolveStatus(status, await listStatuses());
  await patchTicket(id, { status: resolved.id });
  return { id, status: resolved.name, statusId: resolved.id, url: ticketUrl(id) };
}

export interface UpdateTaskInput {
  headline?: string;
  description?: string;
  dueDate?: string;
  sprintId?: string | number;
  priority?: number;
  startDate?: string;
  plannedHours?: number;
}

/** Patch only the provided fields; everything else on the task is left untouched. */
export async function updateTask(id: string | number, input: UpdateTaskInput) {
  const params: Record<string, unknown> = {};
  if (input.headline !== undefined) params.headline = input.headline;
  if (input.description !== undefined) params.description = input.description;
  if (input.dueDate !== undefined) params.dateToFinish = input.dueDate;
  if (input.sprintId !== undefined) params.sprint = input.sprintId;
  if (input.priority !== undefined) params.priority = input.priority;
  if (input.startDate !== undefined) params.editFrom = input.startDate;
  if (input.plannedHours !== undefined) params.planHours = input.plannedHours;
  if (!Object.keys(params).length) {
    throw new Error(
      "Nothing to update: pass at least one of headline, description, due_date, sprint_id, priority, start_date, planned_hours."
    );
  }
  await patchTicket(id, params);
  return { id, updated: Object.keys(params), url: ticketUrl(id) };
}
