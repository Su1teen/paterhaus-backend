import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const MIGRATION_ID = '20260922_001_attachments_escalations';
const ADVISORY_LOCK_NAME = 'paterhaus_chat_history_migrations';
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'chat-history-migrations',
  `${MIGRATION_ID}.sql`,
);

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
  const sql = options.sql ?? (await readFile(migrationPath, 'utf8'));
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

    const applied = await client.query(
      'SELECT id FROM pater_system_migrations WHERE id = $1',
      [MIGRATION_ID],
    );
    if (migrationAlreadyApplied(applied.rows)) {
      await client.query('COMMIT');
      return { id: MIGRATION_ID, applied: false };
    }

    await client.query(sql);
    await client.query('INSERT INTO pater_system_migrations (id) VALUES ($1)', [MIGRATION_ID]);
    await client.query('COMMIT');
    return { id: MIGRATION_ID, applied: true };
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
    .then(({ id, applied }) => {
      process.stdout.write(
        applied ? `Applied chat-history migration ${id}.\n` : `Chat-history migration ${id} already applied.\n`,
      );
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown migration failure';
      process.stderr.write(`Chat-history migration failed: ${message}\n`);
      process.exitCode = 1;
    });
}
