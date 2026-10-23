#!/usr/bin/env node
/**
 * Read-only connectivity check for a real Leantime instance.
 *
 * Loads .env (via dotenv), then lists statuses, projects, sprints and your open
 * tasks so you can confirm the env is correct. Never writes to Leantime and never
 * prints the credentials.
 *
 * Run: npm run check   (after `npm run build`)
 */
import "dotenv/config";
import { listProjects, listSprints, listStatuses, listTasks, listUsers } from "../dist/tasks.js";

function mask(v) {
  return v ? "set" : "MISSING";
}

console.log("Config:");
console.log("  LEANTIME_BASE_URL :", mask(process.env.LEANTIME_BASE_URL));
console.log("  LEANTIME_API_KEY  :", mask(process.env.LEANTIME_API_KEY));
console.log("  LEANTIME_USER_ID  :", process.env.LEANTIME_USER_ID || "(unset)");
console.log("");

try {
  const statuses = await listStatuses();
  console.log(`Statuses (${statuses.length}):`);
  for (const s of statuses) console.log(`  ${s.id}\t${s.name}\t${s.statusType ?? ""}`);

  const projects = await listProjects();
  console.log(`\nProjects: ${projects.length}`);

  const sprints = await listSprints();
  console.log(`Sprints: ${sprints.length}` + (sprints[0] ? ` — newest: #${sprints[0].id} ${sprints[0].name}` : ""));

  const users = await listUsers();
  const me = users.find((u) => u.isConfigured);
  console.log(`Users: ${users.length}` + (me ? ` — you are #${me.id} ${me.name}` : ""));

  if (me) {
    const { total, tasks } = await listTasks({ assigneeId: me.id, excludeDone: true, limit: 10 });
    console.log(`\nYour open tasks (${tasks.length} of ${total}):`);
    for (const t of tasks) console.log(`  #${t.id}  ${t.headline}  [${t.status}]`);
  }
  console.log("\n✓ Leantime connectivity OK");
} catch (err) {
  console.error("\n✗ Leantime check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
