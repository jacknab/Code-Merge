/**
 * server/startup/runMigrations.ts
 *
 * Runs pending SQL migrations from the migrations/ directory at server startup.
 * Tracks applied migrations in the schema_migrations table — each file only
 * ever runs once. Safe to call on every boot.
 *
 * First-run behaviour:
 *   - Fresh database (no tables at all): applies schema.sql to create the full
 *     base schema, then records all migration files as baseline (no re-run).
 *   - Existing database with no migration history: records all current migration
 *     files as baseline (assumes schema was already set up manually or via VPS).
 *   - Normal run: only executes migration files not yet in schema_migrations.
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { pool } from "../db";

// Resolve migrations/ directory in both dev (ESM/tsx) and prod (esbuild CJS).
const _cjsDirname: string | undefined = (globalThis as any).__dirname;
const MIGRATIONS_DIR = _cjsDirname
  ? path.resolve(_cjsDirname, "..", "migrations")
  : path.resolve(process.cwd(), "migrations");

const SCHEMA_SQL = _cjsDirname
  ? path.resolve(_cjsDirname, "..", "schema.sql")
  : path.resolve(process.cwd(), "schema.sql");

async function ensureTrackingTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedCount(client: pg.PoolClient): Promise<number> {
  const r = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM schema_migrations");
  return parseInt(r.rows[0].count, 10);
}

async function getApplied(client: pg.PoolClient): Promise<Set<string>> {
  const r = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(r.rows.map((row) => row.filename));
}

async function dbHasCoreSchema(client: pg.PoolClient): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'locations'
    ) AS exists
  `);
  return r.rows[0].exists;
}

function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("."))
    .sort();
}

async function seedBaseline(client: pg.PoolClient, allFiles: string[]): Promise<void> {
  for (const filename of allFiles) {
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
      [filename]
    );
  }
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);

    const allFiles = getMigrationFiles();
    const appliedCount = await getAppliedCount(client);
    const hasCoreSchema = await dbHasCoreSchema(client);

    // ── Case 1: Totally fresh database — apply schema.sql first ──────────
    if (!hasCoreSchema) {
      if (fs.existsSync(SCHEMA_SQL)) {
        console.log("[migrations] Fresh database detected — applying schema.sql…");
        const schemaSql = fs.readFileSync(SCHEMA_SQL, "utf-8").trim();
        if (schemaSql) {
          await client.query("BEGIN");
          try {
            await client.query(schemaSql);
            await client.query("COMMIT");
            console.log("[migrations] ✓ schema.sql applied");
          } catch (err: any) {
            await client.query("ROLLBACK");
            throw new Error(`schema.sql failed: ${err.message}`);
          }
        }
      } else {
        console.warn("[migrations] WARNING: Fresh database but no schema.sql found — migrations may fail");
      }

      // Record all current migration files as baseline so they don't re-run
      console.log(`[migrations] Seeding ${allFiles.length} migration(s) as baseline…`);
      await seedBaseline(client, allFiles);
      console.log("[migrations] ✓ Baseline seeded. Future migrations will run automatically.");
      return;
    }

    // ── Case 2: Existing DB, no migration history — seed baseline ─────────
    if (appliedCount === 0) {
      console.log(`[migrations] First run on existing DB — seeding ${allFiles.length} migration(s) as baseline…`);
      await seedBaseline(client, allFiles);
      console.log("[migrations] ✓ Baseline seeded. Future migrations will run automatically.");
      return;
    }

    // ── Case 3: Normal run — apply only pending migrations ────────────────
    const applied = await getApplied(client);
    const pending = allFiles.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("[migrations] ✓ Up to date");
      return;
    }

    console.log(`[migrations] Applying ${pending.length} pending migration(s)…`);

    for (const filename of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf-8").trim();
      if (!sql) {
        console.log(`[migrations]   SKIP  ${filename} (empty)`);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`[migrations]   ✓ ${filename}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        throw new Error(`Migration failed [${filename}]: ${err.message}`);
      }
    }

    console.log(`[migrations] ✓ ${pending.length} migration(s) applied`);
  } finally {
    client.release();
  }
}
