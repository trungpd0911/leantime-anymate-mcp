/**
 * Tool registration. Each tool is deterministic — the agent supplies any prose
 * (headlines, descriptions); this server only calls Leantime.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "./constants.js";
import {
  assignTask,
  createSprint,
  createTask,
  getTask,
  listProjects,
  listSprints,
  listStatuses,
  listTasks,
  listUsers,
  setTaskStatus,
  updateTask,
} from "./tasks.js";

type ToolResponse = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Wrap structured data as a JSON tool response, truncating oversized text. */
function ok(data: Record<string, unknown>): ToolResponse {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text = `${text.slice(0, CHARACTER_LIMIT)}\n…[response truncated at ${CHARACTER_LIMIT} chars]`;
  }
  return { content: [{ type: "text", text }], structuredContent: data };
}

/** Turn any thrown error into an actionable, non-throwing tool error. */
function fail(error: unknown): ToolResponse {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const id = z.union([z.string(), z.number()]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const priority = z
  .number()
  .int()
  .min(1)
  .max(5)
  .describe("1 Critical, 2 High, 3 Medium, 4 Low, 5 Lowest");

export function registerTools(server: McpServer): void {
  // -- Read -----------------------------------------------------------------

  server.registerTool(
    "leantime_list_projects",
    {
      title: "List Leantime Projects",
      description: `List Leantime projects visible to the API key. Use it to find a project_id. Read-only.

Returns JSON: { count, projects: [{ id, name }] }`,
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const projects = await listProjects();
        return ok({ count: projects.length, projects });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_list_users",
    {
      title: "List Leantime Users",
      description: `List Leantime users. Use it to find an assignee_id, or the user's own LEANTIME_USER_ID. Read-only.

Returns JSON: { count, users: [{ id, name, username, isConfigured }] }
(isConfigured is true for the id currently set in LEANTIME_USER_ID, if any.)`,
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const users = await listUsers();
        return ok({ count: users.length, users });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_list_sprints",
    {
      title: "List Leantime Sprints",
      description: `List sprints, newest start date first, optionally for one project. Read-only.

Args:
  - project_id (string|number, optional): only sprints of this project

Returns JSON: { count, sprints: [{ id, name, projectId, startDate, endDate }] }`,
      inputSchema: { project_id: id.optional().describe("Filter by project id (from leantime_list_projects)") },
      annotations: READ,
    },
    async ({ project_id }) => {
      try {
        const sprints = await listSprints(project_id);
        return ok({ count: sprints.length, sprints });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_list_statuses",
    {
      title: "List Leantime Statuses",
      description: `List the status labels configured on this Leantime instance (ids differ per instance). Read-only.

Returns JSON: { count, statuses: [{ id, name, statusType }] }`,
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      try {
        const statuses = await listStatuses();
        return ok({ count: statuses.length, statuses });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_list_tasks",
    {
      title: "List Leantime Tasks",
      description: `List tasks, newest first, with optional filters (all combined with AND). Read-only.

Args:
  - assignee_id (string|number, optional): only tasks assigned to this user (from leantime_list_users)
  - project_id (string|number, optional)
  - sprint_id (string|number, optional)
  - status (string, optional): status name, case-insensitive (see leantime_list_statuses)
  - exclude_done (boolean, optional): drop tasks whose status is Done or Archived
  - limit (number, optional): max tasks returned (1-200, default LEANTIME_PICK_LIMIT or 30)

Returns JSON: { total, count, tasks: [{ id, headline, type, status, priority, projectId, projectName, sprintId, sprintName, assigneeId, assignee, dueDate, url, description }] }
(total = matches before the limit; description is a short snippet — use leantime_get_task for the full text.)`,
      inputSchema: {
        assignee_id: id.optional().describe("Assignee user id"),
        project_id: id.optional().describe("Project id"),
        sprint_id: id.optional().describe("Sprint id"),
        status: z.string().optional().describe('Status name, e.g. "In Progress"'),
        exclude_done: z.boolean().optional().describe("Exclude Done and Archived tasks"),
        limit: z.number().int().min(1).max(200).optional().describe("Max tasks to return"),
      },
      annotations: READ,
    },
    async ({ assignee_id, project_id, sprint_id, status, exclude_done, limit }) => {
      try {
        const { total, tasks } = await listTasks({
          assigneeId: assignee_id,
          projectId: project_id,
          sprintId: sprint_id,
          status,
          excludeDone: exclude_done,
          limit,
        });
        return ok({ total, count: tasks.length, tasks });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_get_task",
    {
      title: "Get Leantime Task",
      description: `Fetch one task's full detail, with the description stripped of HTML. Read-only.

Args:
  - id (string|number): the task id

Returns JSON: { found: true, id, headline, type, status, priority, projectId, projectName, sprintId, sprintName, assigneeId, assignee, dueDate, url, description } or { found: false, id }`,
      inputSchema: { id: id.describe("Task id") },
      annotations: READ,
    },
    async ({ id }) => {
      try {
        const task = await getTask(id);
        if (!task) return ok({ found: false, id });
        return ok({ found: true, ...task });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // -- Write ----------------------------------------------------------------

  server.registerTool(
    "leantime_create_sprint",
    {
      title: "Create Leantime Sprint",
      description: `Create a sprint in a project.

Args:
  - project_id (string|number)
  - name (string)
  - start_date (string): YYYY-MM-DD
  - end_date (string): YYYY-MM-DD, not before start_date

Returns JSON: { id, name, projectId, startDate, endDate }`,
      inputSchema: {
        project_id: id.describe("Project id"),
        name: z.string().min(1).describe("Sprint name"),
        start_date: isoDate.describe("First day, YYYY-MM-DD"),
        end_date: isoDate.describe("Last day, YYYY-MM-DD"),
      },
      annotations: CREATE,
    },
    async ({ project_id, name, start_date, end_date }) => {
      try {
        const sprint = await createSprint({ projectId: project_id, name, startDate: start_date, endDate: end_date });
        return ok({ ...sprint });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_create_task",
    {
      title: "Create Leantime Task",
      description: `Create a task with status "New".

Before calling: if the user did not say who the task is for, ask them to confirm the assignee (suggest themselves = LEANTIME_USER_ID, or someone from leantime_list_users) — do not pick one silently. Omitting assignee_id leaves the task unassigned.

Args:
  - project_id (string|number)
  - headline (string): task title, written by you
  - sprint_id (string|number, optional): omit for backlog
  - assignee_id (string|number, optional)
  - description (string, optional): HTML is accepted (Leantime stores rich text)
  - priority (number, optional): 1 Critical, 2 High, 3 Medium, 4 Low, 5 Lowest
  - type (string, optional): task (default), story or bug
  - due_date (string, optional): YYYY-MM-DD

Returns JSON: { id, headline, status, assigneeId, url }`,
      inputSchema: {
        project_id: id.describe("Project id"),
        headline: z.string().min(1).describe("Task title"),
        sprint_id: id.optional().describe("Sprint id; omit for backlog"),
        assignee_id: id.optional().describe("Assignee user id"),
        description: z.string().optional().describe("Task description (HTML accepted)"),
        priority: priority.optional(),
        type: z.enum(["task", "story", "bug"]).optional().describe("Ticket type, default task"),
        due_date: isoDate.optional().describe("Due date, YYYY-MM-DD"),
      },
      annotations: CREATE,
    },
    async ({ project_id, headline, sprint_id, assignee_id, description, priority, type, due_date }) => {
      try {
        const task = await createTask({
          projectId: project_id,
          headline,
          sprintId: sprint_id,
          assigneeId: assignee_id,
          description,
          priority,
          type,
          dueDate: due_date,
        });
        return ok({ ...task });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_assign_task",
    {
      title: "Assign Leantime Task",
      description: `Assign a task to a user. Only the assignee changes.

Args:
  - task_id (string|number)
  - assignee_id (string|number): user id from leantime_list_users

Returns JSON: { id, assigneeId, url }`,
      inputSchema: {
        task_id: id.describe("Task id"),
        assignee_id: id.describe("Assignee user id"),
      },
      annotations: UPDATE,
    },
    async ({ task_id, assignee_id }) => {
      try {
        return ok(await assignTask(task_id, assignee_id));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_set_task_status",
    {
      title: "Set Leantime Task Status",
      description: `Change a task's status by name (case-insensitive). Only the status changes.

Args:
  - task_id (string|number)
  - status (string): full status name, e.g. "In Progress", "Waiting for Approval", "Q&A". An unknown name returns an error listing the valid ones.

Returns JSON: { id, status, statusId, url }`,
      inputSchema: {
        task_id: id.describe("Task id"),
        status: z.string().min(1).describe("Status name"),
      },
      annotations: UPDATE,
    },
    async ({ task_id, status }) => {
      try {
        return ok(await setTaskStatus(task_id, status));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "leantime_update_task",
    {
      title: "Update Leantime Task",
      description: `Update some fields of a task. Only the fields you pass change; everything else is kept.

Args:
  - task_id (string|number)
  - headline (string, optional)
  - description (string, optional): replaces the whole description (HTML accepted)
  - due_date (string, optional): YYYY-MM-DD
  - sprint_id (string|number, optional): move to this sprint
  - priority (number, optional): 1 Critical, 2 High, 3 Medium, 4 Low, 5 Lowest

Returns JSON: { id, updated: [field names], url }`,
      inputSchema: {
        task_id: id.describe("Task id"),
        headline: z.string().min(1).optional().describe("New title"),
        description: z.string().optional().describe("New description (HTML accepted)"),
        due_date: isoDate.optional().describe("New due date, YYYY-MM-DD"),
        sprint_id: id.optional().describe("Move to this sprint id"),
        priority: priority.optional(),
      },
      annotations: UPDATE,
    },
    async ({ task_id, headline, description, due_date, sprint_id, priority }) => {
      try {
        return ok(await updateTask(task_id, { headline, description, dueDate: due_date, sprintId: sprint_id, priority }));
      } catch (e) {
        return fail(e);
      }
    }
  );
}
