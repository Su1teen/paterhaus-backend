import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { prisma } from './lib/prisma.js';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error) => {
  // Startup failures must not leak environment values.
  console.error('Failed to start paterhaus-backend:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});
