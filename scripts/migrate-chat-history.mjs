import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const CHAT_HISTORY_MIGRATION_IDS = [
  '20260922_001_attachments_escalations',
  '20260923_002_remove_waha_status_pollution',
];
/** Backward-compatible name for the original migration. */
export const MIGRATION_ID = CHAT_HISTORY_MIGRATION_IDS[0];
const ADVISORY_LOCK_NAME = 'paterhaus_chat_history_migrations';
const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'chat-history-migrations');

function migrationPath(id) {
  return join(migrationsDirectory, `${id}.sql`);
}

export async function loadChatHistoryMigrations() {
  return Promise.all(
    CHAT_HISTORY_MIGRATION_IDS.map(async (id) => ({
      id,
      sql: await readFile(migrationPath(id), 'utf8'),
    })),
  );
}

/** Exported for a deterministic unit test of the once-only decision. */
export function migrationAlreadyApplied(rows, migrationId = MIGRATION_ID) {
  return rows.some((row) => row.id === migrationId);
}

export async function migrateChatHistory(options = {}) {
  const connectionString = options.connectionString ?? process.env.CHAT_HISTORY_DATABASE_URL;
  if (!connectionString) {
    throw new Error('CHAT_HISTORY_DATABASE_URL is required for chat-history migrations.');
  }

  const Pool = options.Pool ?? pg.Pool;
  const migrations = options.migrations ?? (await loadChatHistoryMigrations());
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ADVISORY_LOCK_NAME]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pater_system_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const results = [];
    for (const migration of migrations) {
      const applied = await client.query(
        'SELECT id FROM pater_system_migrations WHERE id = $1',
        [migration.id],
      );
      if (migrationAlreadyApplied(applied.rows, migration.id)) {
        results.push({ id: migration.id, applied: false });
        continue;
      }

      await client.query(migration.sql);
      await client.query('INSERT INTO pater_system_migrations (id) VALUES ($1)', [migration.id]);
      results.push({ id: migration.id, applied: true });
    }
    await client.query('COMMIT');
    return { migrations: results };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original migration error.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

const isEntrypoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  migrateChatHistory()
    .then(({ migrations }) => {
      const applied = migrations.filter((migration) => migration.applied).map((migration) => migration.id);
      process.stdout.write(
        applied.length > 0
          ? `Applied chat-history migrations: ${applied.join(', ')}.\n`
          : 'All chat-history migrations are already applied.\n',
      );
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown migration failure';
      process.stderr.write(`Chat-history migration failed: ${message}\n`);
      process.exitCode = 1;
    });
}
