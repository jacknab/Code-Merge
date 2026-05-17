import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const SLOW_QUERY_THRESHOLD_MS = 200;
const STATEMENT_TIMEOUT_MS    = 30_000;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // ── Pool sizing ────────────────────────────────────────────────────────────
  // Keep this ≤ the DB's max_connections limit (Replit PG default: 100).
  // 20 app connections leaves headroom for admin tools and background workers.
  max: 20,
  min: 2,

  // ── Timeouts ───────────────────────────────────────────────────────────────
  // How long a client waits to be acquired from the pool before erroring.
  connectionTimeoutMillis: 5_000,
  // How long an idle connection stays alive before being closed.
  idleTimeoutMillis: 30_000,
  // How long a query is allowed to run before being forcibly killed.
  // Protects against runaway queries degrading the whole pool.
  statement_timeout: STATEMENT_TIMEOUT_MS,
  // Identify this app in pg_stat_activity for easier monitoring.
  application_name: "certxa-salonos",
});

// ── Slow-query instrumentation ─────────────────────────────────────────────
// Wraps every pg.query call and emits a warning when a query exceeds the
// threshold. Adds zero overhead in the happy path (fast queries).
const originalQuery = pool.query.bind(pool) as typeof pool.query;
(pool as any).query = function (...args: Parameters<typeof originalQuery>) {
  const start = Date.now();
  const promise = (originalQuery as any)(...args);
  promise
    .then(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= SLOW_QUERY_THRESHOLD_MS) {
        const text =
          typeof args[0] === "string"
            ? args[0].slice(0, 120)
            : (args[0] as any)?.text?.slice(0, 120) ?? "<unknown>";
        console.warn(`[db:slow] ${elapsed}ms — ${text}`);
      }
    })
    .catch(() => {});
  return promise;
};

// ── Pool error handling ────────────────────────────────────────────────────
// Prevents uncaught exceptions from idle connection drops (e.g. DB restarts).
pool.on("error", (err) => {
  console.error("[db:pool] Unexpected idle client error:", err.message);
});

pool.on("connect", () => {
  // Log when pool creates a new physical connection (useful for diagnosing leaks)
  if (process.env.NODE_ENV === "development") {
    console.debug("[db:pool] New connection established");
  }
});

export const db = drizzle(pool, { schema });

// ── Health-check helper ────────────────────────────────────────────────────
// Used by /api/health and startup checks.
export async function dbHealthCheck(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
