# leantime-anymate-mcp

MCP server (stdio) that lets an agent (Claude Code, Codex, ...) manage Leantime: list projects,
users, sprints and statuses; list and filter tasks; create sprints and tasks; assign, change status
and update tasks. It has no delete tools.

The server is deterministic and AI-free: the agent writes headlines and descriptions, and the server
only calls Leantime's JSON-RPC API. Checked against Leantime **v3.5.4**.

## Installation

### 1. Get your Leantime credentials

- **API key**: in Leantime, go to *Company settings → API → Create API key*. Tasks and sprints are
  created as the user that owns the key, with that user's permissions.
- **User id** (optional): your numeric id. The easy way is to set only the URL and key, restart,
  then ask the agent to run `leantime_list_users`.

### 2. Add the server to your client

`npx` downloads this repo at the given tag, builds it once (`prepare` script), caches it and runs
it. No manual clone is needed. Always pin a release tag (`#v1.0.0`); see
[Updating](#updating) for why.

**Claude Code** (`-s user` makes it available in every project)

```bash
claude mcp add -s user leantime-anymate \
  -e LEANTIME_BASE_URL=https://leantime.example.com \
  -e LEANTIME_API_KEY=your-key \
  -e LEANTIME_USER_ID=123 \
  -- npx -y github:trungpd0911/leantime-anymate-mcp#v1.0.0
```

This writes to `~/.claude.json`. You can also add it by hand there, or in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "leantime-anymate": {
      "command": "npx",
      "args": ["-y", "github:trungpd0911/leantime-anymate-mcp#v1.0.0"],
      "env": {
        "LEANTIME_BASE_URL": "https://leantime.example.com",
        "LEANTIME_API_KEY": "your-key",
        "LEANTIME_USER_ID": "123"
      }
    }
  }
}
```

Do not commit a `.mcp.json` that contains your API key.

**Codex**

```bash
codex mcp add leantime-anymate \
  --env LEANTIME_BASE_URL=https://leantime.example.com \
  --env LEANTIME_API_KEY=your-key \
  --env LEANTIME_USER_ID=123 \
  -- npx -y github:trungpd0911/leantime-anymate-mcp#v1.0.0
```

This writes to `~/.codex/config.toml`. The same entry by hand:

```toml
[mcp_servers.leantime-anymate]
command = "npx"
args = ["-y", "github:trungpd0911/leantime-anymate-mcp#v1.0.0"]
env = { LEANTIME_BASE_URL = "https://leantime.example.com", LEANTIME_API_KEY = "your-key", LEANTIME_USER_ID = "123" }
```

### 3. Restart and verify

Restart the client. The first start is slower because `npx` downloads and builds the repo.

- Claude Code: run `/mcp` and check that `leantime-anymate` is connected.
- Codex: run `/mcp` and check that the `leantime_*` tools are listed.

Then ask the agent to "list Leantime statuses".

## Updating

New versions are published as Git tags (`v1.1.0`, ...). See the repo's tags or releases for what
changed.

To update, change the tag in your client config, then restart the client. The env stays where it
is, so **you do not need to enter it again**, unless the release notes list a new variable.

- Claude Code: in `~/.claude.json` (or `.mcp.json`), change
  `github:trungpd0911/leantime-anymate-mcp#v1.0.0` to the new tag.
- Codex: in `~/.codex/config.toml`, change the same string in `args`.

Avoid `claude mcp remove` / `codex mcp remove` followed by `add`. That deletes the entry, so you
would have to type the env again.

Why pin a tag: `npx` caches by the exact spec string. With an unpinned
`github:trungpd0911/leantime-anymate-mcp`, it may keep running the old cached build after the repo
changes. A new tag is a new spec, so `npx` downloads it fresh.

If you installed without a tag and want the latest version, clear the npx cache and restart the
client:

```bash
rm -rf "$(npm config get cache)/_npx"
```

This also clears the cache of other `npx` tools. They are downloaded again the next time they run.

## Configuration (env)

| Variable | Required | Meaning |
|-|-|-|
| `LEANTIME_BASE_URL` | yes | Leantime instance URL |
| `LEANTIME_API_KEY` | yes | Sent as the `x-api-key` header |
| `LEANTIME_USER_ID` | recommended | Your numeric user id; suggested as the default assignee |
| `LEANTIME_PICK_LIMIT` | no | Default max tasks returned by `leantime_list_tasks` (default 30) |

The server starts without env. Each tool checks the env when it is called and returns a clear error
if something is missing. See [`.env.example`](.env.example).

## Tools

| Tool | Type | Purpose |
|-|-|-|
| `leantime_list_projects` | read | `id, name` |
| `leantime_list_users` | read | Find an `assignee_id` |
| `leantime_list_sprints` | read | Optional `project_id`, newest first |
| `leantime_list_statuses` | read | `id, name, statusType` of this instance |
| `leantime_list_tasks` | read | Filters: `assignee_id`, `project_id`, `sprint_id`, `status` (name), `exclude_done` (Done + Archived), `limit` |
| `leantime_get_task` | read | Full detail of one task |
| `leantime_create_sprint` | write | `project_id, name, start_date, end_date` (YYYY-MM-DD) |
| `leantime_create_task` | write | `project_id, headline`, optional `sprint_id, assignee_id, description, priority, type, due_date, start_date, planned_hours`; status "New" |
| `leantime_assign_task` | write, idempotent | `task_id, assignee_id` |
| `leantime_set_task_status` | write, idempotent | `task_id, status` (name, case-insensitive) |
| `leantime_update_task` | write, idempotent | `task_id` + any of `headline, description, due_date, sprint_id, priority, start_date, planned_hours` |

Notes:

- Status ids differ per instance. Statuses are always looked up by name through `getStatusLabels`
  and are never hard-coded.
- Assign, set status and update use Leantime's `tickets.patch`, which changes only the fields that
  are sent. `tickets.updateTicket` is avoided because in v3.5.4 it overwrites every column, so any
  field you leave out is blanked.
- `start_date` is Leantime's "Work Start" (`editFrom`) and `planned_hours` is "Planned Hours"
  (`planHours`). All dates are `YYYY-MM-DD`.
- If the user did not name an assignee, `leantime_create_task` tells the agent to ask the user to
  confirm one first.

## Local development

```bash
npm install
npm run build      # → dist/index.js
npm test           # vitest, Leantime is mocked (no network)
npm run dev        # tsx watch
```

**Check a real instance without writing anything**: copy `.env.example` to `.env`, fill in the
values, then run:

```bash
npm run build && npm run check
```

**Call tools by hand** with MCP Inspector (env from `.env` or the Inspector UI):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

**Use a local build in Claude Code or Codex** before publishing. `DOTENV_CONFIG_PATH` points the
server at an existing `.env` file, so the key stays out of the client config:

```bash
claude mcp add -s user leantime-anymate \
  -e DOTENV_CONFIG_PATH=/absolute/path/to/.env \
  -- node /absolute/path/to/leantime-anymate-mcp/dist/index.js

codex mcp add leantime-anymate \
  --env DOTENV_CONFIG_PATH=/absolute/path/to/.env \
  -- node /absolute/path/to/leantime-anymate-mcp/dist/index.js
```

Without `DOTENV_CONFIG_PATH` the server reads `.env` from its working directory, which is the
project the client runs in, not this repo.

Write tools create real data and there is no delete tool, so test them on a scratch project or
sprint.

## Releasing (maintainer)

```bash
npm run build && npm test
npm version minor          # or patch/major: bumps package.json, commits, creates tag vX.Y.Z
git push --follow-tags
```

Then tell users the new tag. Mention any new env variable in the release notes.

## Credits

The Leantime client is ported from [`ai-git-fish`](https://github.com/DucTam2411/ai-git-fish) by
DucTam2411, and the server structure follows `ai-git-mcp`.
