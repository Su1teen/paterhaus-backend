import { describe, expect, it, vi } from 'vitest';

// The deployment runner intentionally remains executable plain ESM.
// @ts-expect-error The .mjs runner has no generated declaration file.
import { CHAT_HISTORY_MIGRATION_IDS, MIGRATION_ID, loadChatHistoryMigrations, migrateChatHistory, migrationAlreadyApplied } from '../scripts/migrate-chat-history.mjs';

interface ChatHistoryMigration {
  id: string;
  sql: string;
}

function migrationPool(appliedIds: Set<string>) {
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    if (text.startsWith('SELECT id FROM pater_system_migrations')) {
      const id = values?.[0];
      return { rows: typeof id === 'string' && appliedIds.has(id) ? [{ id }] : [] };
    }
    if (text.startsWith('INSERT INTO pater_system_migrations')) {
      const id = values?.[0];
      if (typeof id === 'string') appliedIds.add(id);
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const end = vi.fn();
  class TestPool {
    connect = vi.fn(async () => ({ query, release }));
    end = end;
  }
  return { TestPool, query, release, end };
}

describe('chat-history migration runner', () => {
  it('recognizes an already-applied migration', () => {
    expect(migrationAlreadyApplied([{ id: MIGRATION_ID }])).toBe(true);
    expect(migrationAlreadyApplied([])).toBe(false);
  });

  it('loads the established migration before the status cleanup migration', async () => {
    const migrations = await loadChatHistoryMigrations();

    expect((migrations as ChatHistoryMigration[]).map((migration) => migration.id)).toEqual(CHAT_HISTORY_MIGRATION_IDS);
    expect(migrations[0]?.sql).toContain('CREATE TABLE IF NOT EXISTS pater_attachments');
  });

  it('preserves an applied 001, records 002 once, and skips both on a repeat run', async () => {
    const appliedIds = new Set([MIGRATION_ID]);
    const pool = migrationPool(appliedIds);
    const migrations = [
      { id: MIGRATION_ID, sql: 'CREATE TABLE should_not_run (id integer)' },
      { id: CHAT_HISTORY_MIGRATION_IDS[1], sql: 'DELETE FROM targeted_status_rows' },
    ];

    const first = await migrateChatHistory({
      connectionString: 'postgresql://test',
      Pool: pool.TestPool,
      migrations,
    });

    expect(first).toEqual({
      migrations: [
        { id: MIGRATION_ID, applied: false },
        { id: CHAT_HISTORY_MIGRATION_IDS[1], applied: true },
      ],
    });
    expect(pool.query).not.toHaveBeenCalledWith('CREATE TABLE should_not_run (id integer)');
    expect(pool.query).toHaveBeenCalledWith('DELETE FROM targeted_status_rows');
    expect(pool.query).toHaveBeenCalledWith(
      'INSERT INTO pater_system_migrations (id) VALUES ($1)',
      [CHAT_HISTORY_MIGRATION_IDS[1]],
    );

    const second = await migrateChatHistory({
      connectionString: 'postgresql://test',
      Pool: pool.TestPool,
      migrations,
    });

    expect(second).toEqual({
      migrations: [
        { id: MIGRATION_ID, applied: false },
        { id: CHAT_HISTORY_MIGRATION_IDS[1], applied: false },
      ],
    });
    expect(pool.query).toHaveBeenCalledWith('COMMIT');
    expect(pool.release).toHaveBeenCalledTimes(2);
    expect(pool.end).toHaveBeenCalledTimes(2);
  });

  it('targets only status/blank-chat pollution and technical attachment summaries', async () => {
    const migrations = await loadChatHistoryMigrations();
    const cleanup = (migrations as ChatHistoryMigration[]).find(
      (migration) => migration.id === CHAT_HISTORY_MIGRATION_IDS[1],
    )?.sql;

    expect(cleanup).toContain("LOWER(COALESCE(waha_message_id, '')) LIKE '%status@broadcast%'");
    expect(cleanup).toContain("LOWER(COALESCE(file_name, '')) LIKE '%status@broadcast%'");
    expect(cleanup).toContain("DELETE FROM hostory_pater\nWHERE BTRIM(COALESCE(chat_id, '')) = ''");
    expect(cleanup).toContain("DELETE FROM chats_pater\nWHERE BTRIM(COALESCE(chat_id, '')) = ''\n  AND BTRIM(COALESCE(number, '')) = ''");
    expect(cleanup).toContain("IF to_regclass('pater_classification') IS NOT NULL THEN");
    expect(cleanup).toContain('UPDATE pater_attachments\nSET summary = NULL');
    expect(cleanup).toContain("LOWER(summary) LIKE '%wordprocessingml%'");
  });
});
