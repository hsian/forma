import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { resolveDatabasePath } from './config.js';

export const defaultDatabasePath = resolveDatabasePath({ NODE_ENV: process.env.NODE_ENV });
export function openDatabase(filename = resolveDatabasePath()) {
  const path = filename === ':memory:' ? filename : resolve(filename);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  try {
    migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  } catch (error) { sqlite.close(); throw error; }
  return { db, sqlite, close: () => sqlite.close() };
}
export type AppDatabase = ReturnType<typeof openDatabase>['db'];
