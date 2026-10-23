/**
 * Shared constants and environment access.
 */

/** Maximum size (characters) of any single tool text response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Default cap on tasks returned by leantime_list_tasks. */
export const DEFAULT_PICK_LIMIT = 30;

/** Resolve the configured task-list limit from env, falling back to the default. */
export function configuredPickLimit(): number {
  const raw = process.env.LEANTIME_PICK_LIMIT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PICK_LIMIT;
}

export interface LeantimeConfig {
  baseUrl: string;
  apiKey: string;
  userId?: string;
}

/**
 * Read Leantime config from the environment.
 * Throws an actionable error when required values are missing — callers surface
 * the message to the agent so it can tell the user what to configure.
 */
export function leantimeConfig(): LeantimeConfig {
  const baseUrl = process.env.LEANTIME_BASE_URL;
  const apiKey = process.env.LEANTIME_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Leantime is not configured: set LEANTIME_BASE_URL and LEANTIME_API_KEY in the MCP server env."
    );
  }
  return { baseUrl, apiKey, userId: process.env.LEANTIME_USER_ID };
}
