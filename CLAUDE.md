# leantime-anymate-mcp — Agent Instructions

MCP server (stdio) để agent quản lý Leantime của AnyMate: tạo sprint/task, assign, đổi status,
liệt kê task theo status/assignee/sprint, update task.

**Trạng thái: v1 đã code xong** (11 tool, build + test pass với mock). Chưa smoke test trên instance thật.
`HANDOFF.md` chứa khảo sát khả thi, quyết định đã chốt và lịch sử.

@HANDOFF.md

## Ràng buộc cứng

- **Độc lập hoàn toàn với `ai-git-mcp`**: package, process, config riêng. Không import, không phụ thuộc
  code của nhau. Copy cấu trúc/client sang, đừng link package. `get_task` là bản riêng của server này.
- **Không có tool xoá** ở v1.
- Tool tên dạng `leantime_*`, giữ nhỏ và deterministic: agent tự viết nội dung (headline, description),
  server chỉ gọi API.

## Secret policy (luật cứng)

- Không đọc `.env`, `.env.*`, file key/credential, hay dump env (`printenv`, `env`, `set`, `export`).
- Chỉ document **tên biến**: `LEANTIME_BASE_URL`, `LEANTIME_API_KEY`, `LEANTIME_USER_ID`, `LEANTIME_PICK_LIMIT`, `MCP_AUTH_TOKEN` (HTTP mode).
  Không ghi giá trị thật, URL instance thật hay key vào docs, log, commit, test.
- Test dùng mock `fetch`. Nếu cần chạy với instance thật (verify `addSprint`, `getStatusLabels`),
  nói rõ biến cần thiết và nhờ user chạy hoặc đưa kết quả đã redact. Không tự đọc secret để chạy.
- Không đọc `.env` của `../ai-git-mcp` hay `../ai-git-fish` khi tham khảo; chỉ đọc source `.ts`/`.md`.

## Tham khảo (chỉ đọc, đừng sửa)

| Path | Dùng để |
|-|-|
| `../ai-git-mcp/src/index.ts`, `constants.ts`, `tools.ts` | Mẫu khởi tạo server, `ok()`/`fail()`, zod schema, annotations |
| `../ai-git-mcp/src/leantime.ts`, `tickets.ts` | Mẫu client JSON-RPC và logic ticket |
| `../ai-git-mcp/docs/superpowers/specs/2026-06-04-ai-git-mcp-design.md` | Design spec gốc |
| `../ai-git-fish/leantime/src/leantime.ts`, `add-task.ts`, `set-status.ts` | Code đã chạy thật: `createTicket`, `updateTicketStatus`, `fetchAllSprints`, `fetchProjects` |

Đừng sửa `ai-git-mcp` / `ai-git-fish` khi làm việc ở đây.

## Stack và style

- Node >= 18, TypeScript strict, ESM (`module: Node16`), `@modelcontextprotocol/sdk`, `zod`, `dotenv`, `vitest`, `tsx`.
- Bám style của `ai-git-mcp`: double quotes, semicolons, 2 spaces, import có đuôi `.js`.
- Env validate **lazy theo từng call** (`leantimeConfig()` throw lỗi rõ ràng), không fail lúc khởi động.
- Mọi response qua `ok()`/`fail()`; cắt text vượt `CHARACTER_LIMIT` (25000).
- Annotations: tool đọc `readOnlyHint: true`; tool ghi `readOnlyHint: false, destructiveHint: false`,
  `idempotentHint: true` cho assign/set status/update.
- **Code comment viết bằng tiếng Anh** (kể cả khi chat tiếng Việt).

## Gotchas của Leantime (đã biết)

- Endpoint: `POST {BASE}/api/jsonrpc`, header `x-api-key`, JSON-RPC 2.0, method dạng `leantime.rpc.<module>.<service>.<method>`.
- **Không dùng `updateTicket`**: ở v3.5.4 nó ghi đè mọi cột, field không gửi bị set `''` (mất description, assignee, sprint...).
  Dùng `leantime.rpc.tickets.tickets.patch` với `{ id, params: {...} }`: chỉ cập nhật key được gửi, không cần `projectId`.
- **Không hard-code status id**: lấy từ `leantime.rpc.tickets.tickets.getStatusLabels`, tra theo tên không phân biệt hoa thường.
  Status của AnyMate: New, Blocked, In Progress, Waiting for Approval, Done, Archived, Q&A, Confirmed.
- `tickets.getAll` trả toàn bộ ticket → lọc ở client, luôn có `limit`.
- `addSprint` (đã đọc source v3.5.4): `leantime.rpc.sprints.sprints.addSprint` với `{ params: { name, projectId, startDate, endDate } }`,
  trả id. Ngày gửi `YYYY-MM-DD` (fallback parser chấp nhận, dù date format của user là m/d/Y).
- Instance AnyMate chạy **Leantime 3.5.4**. API chỉ nhận API key, không nhận session cookie.
- Users: thử lần lượt `users.users.getAll`, `users.getAll`, `users.users.getAllUsers` (khác biệt giữa version).

## Quyết định đã chốt (2026-10-23)

- `exclude_done` loại **Done + Archived** (so theo tên).
- `create_task` không tự assign: thiếu `assignee_id` thì agent phải hỏi user confirm (ghi trong description của tool).
- Repo GitHub: repo mới, public, của user.

## Verification trước khi báo xong

- `npm run build` pass, `npm test` pass (mock `fetch`).
- Mỗi tool có test ít nhất cho happy path và lỗi thiếu env.
- Báo rõ phần nào chưa verify trên instance thật.

## Git

- Conventional commits. Không commit `.env`, `dist/`, `node_modules/`.
- Chỉ commit/push khi user yêu cầu.
