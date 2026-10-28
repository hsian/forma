import Fastify from 'fastify';
import middie from '@fastify/middie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/index.js';
import { createRepository } from './db/repository.js';
import { registerApi } from './api.js';
import { registerAi } from './ai/routes.js';
import { existsSync } from 'node:fs';
import { registerAuth } from './auth.js';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
const database = openDatabase();
const repository = createRepository(database.db);
repository.initialize();
app.addHook('onClose', async () => { database.close(); });
app.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
});
const auth = registerAuth(app, database.db);
registerApi(app, repository, auth);
registerAi(app, database.db, auth);

if (process.argv.includes('--production')) {
  await app.register(fastifyStatic, { root: fileURLToPath(new URL('../dist', import.meta.url)) });
  app.get('/preview', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/design', async (_request, reply) => reply.sendFile('index.html'));
  app.get('/workbench', async (request, reply) => { const legacy = new URL(request.url, 'http://localhost'); const query = new URLSearchParams(); for (const key of ['projectId', 'pageId']) { const value = legacy.searchParams.get(key); if (value) query.set(key, value); } return reply.redirect(`/${query.size ? '?' + query : ''}`); });
  app.get('/manage', async (_request, reply) => reply.sendFile('index.html'));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  await app.register(middie);
  app.use((request, response, next) => {
    if (request.url?.startsWith('/api/')) return next();
    vite.middlewares(request, response, next);
  });
  app.addHook('onClose', async () => { await vite.close(); });
}
await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
