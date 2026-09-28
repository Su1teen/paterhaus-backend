import { execFileSync } from 'node:child_process';

/** Applies Prisma migrations to the test database once before the suite runs. */
export default function setup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL must explicitly identify a disposable test database');
  }
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.split('/').pop() ?? '');
  if (!/(test|disposable)/i.test(databaseName) || databaseUrl === process.env.CHAT_HISTORY_DATABASE_URL) {
    throw new Error('Refusing migrations: TEST_DATABASE_URL must name an isolated test/disposable database');
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
