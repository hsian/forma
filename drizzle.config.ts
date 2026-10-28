import { defineConfig } from 'drizzle-kit';
import { loadEnvironment, resolveDatabasePath } from './server/db/config';
loadEnvironment();
export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: resolveDatabasePath() },
});
