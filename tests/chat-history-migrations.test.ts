import { describe, expect, it, vi } from 'vitest';

// The deployment runner intentionally remains executable plain ESM.
// @ts-expect-error The .mjs runner has no generated declaration file.
import { MIGRATION_ID, migrateChatHistory, migrationAlreadyApplied } from '../scripts/migrate-chat-history.mjs';

describe('chat-history migration runner', () => {
  it('recognizes an already-applied migration', () => {
    expect(migrationAlreadyApplied([{ id: MIGRATION_ID }])).toBe(true);
    expect(migrationAlreadyApplied([])).toBe(false);
  });

  it('commits without executing migration SQL when the migration was already applied', async () => {
    const query = vi.fn(async (text: string) => ({
      rows: text.startsWith('SELECT id FROM pater_system_migrations') ? [{ id: MIGRATION_ID }] : [],
    }));
    const release = vi.fn();
    const end = vi.fn();
    class TestPool {
      connect = vi.fn(async () => ({ query, release }));
      end = end;
    }

    const result = await migrateChatHistory({
      connectionString: 'postgresql://test',
      Pool: TestPool,
      sql: 'CREATE TABLE should_not_run (id integer)',
    });

    expect(result).toEqual({ id: MIGRATION_ID, applied: false });
    expect(query).not.toHaveBeenCalledWith('CREATE TABLE should_not_run (id integer)');
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
  });
});
