import { Pool } from 'pg';
import { getEnv } from '../config/env.js';

let pool: Pool | undefined;

export function getChatHistoryPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getEnv().CHAT_HISTORY_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function closeChatHistoryPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
