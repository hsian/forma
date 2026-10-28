import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadEnvironment() {
  const path = fileURLToPath(new URL('../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function isProduction(env: NodeJS.ProcessEnv = process.env, args: readonly string[] = process.argv) {
  return args.includes('--production') || (!args.includes('--development') && env.NODE_ENV === 'production');
}

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env, args: readonly string[] = process.argv) {
  if (env.DATABASE_PATH) return env.DATABASE_PATH === ':memory:' ? ':memory:' : resolve(env.DATABASE_PATH);
  return fileURLToPath(new URL(isProduction(env, args) ? '../../data/forma.db' : '../../data/forma.dev.db', import.meta.url));
}
