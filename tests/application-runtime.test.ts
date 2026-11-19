import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
import { registerAuth } from '../server/auth';
import { makeElement } from '../shared/model';

async function fixture(authenticated = false) {
  mkdirSync('test-results', { recursive: true });
  const rootDirectory = mkdtempSync(resolve('test-results/runtime-'));
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify();
  const auth = authenticated ? registerAuth(app, connection.db) : undefined;
  registerApi(app, repository, auth, { rootDirectory });
  app.addHook('onClose', async () => connection.close());
  let admin = '';
  if (authenticated) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } });
    admin = String(response.headers['set-cookie']).split(';')[0];
  }
  const response = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: '真实业务工程', application: { templateId: 'admin', directoryName: 'runtime-app' } } });
  assert.equal(response.statusCode, 200, response.body);
  const { project, page } = response.json();
  return { app, repository, admin, project, page, directory: project.application.directory as string };
}

test('真实预览运行项目 Vite 配置和源码，经受保护的同源地址转发并支持停止与重启', async () => {
  const f = await fixture();
  const runtime = `/api/projects/${f.project.id}/runtime`;
  try {
    const document = f.repository.readDocument(f.page.id)!;
    document.document.elements.push({ ...makeElement('text'), text: '来自实际业务源码' });
    f.repository.saveDocument(f.page.id, document.revision, document.document);
    // A business project's /api proxy must not intercept preview HTML or module requests.
    const config = resolve(f.directory, 'vite.config.ts');
    writeFileSync(config, readFileSync(config, 'utf8').replace('plugins: [react()]', `plugins: [react(), { name: 'actual-project-config', configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url?.endsWith('/proof')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ projectConfiguration: true, cookie: req.headers.cookie || null, authorization: req.headers.authorization || null })); } else next(); }); } }]`).replace('fs: { deny:', `proxy: { '/api': { target: 'http://127.0.0.1:1' } }, fs: { deny:`));
    const [first, concurrent] = await Promise.all([
      f.app.inject({ method: 'POST', url: `${runtime}/start` }),
      f.app.inject({ method: 'POST', url: `${runtime}/start` }),
    ]);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(concurrent.statusCode, 200, concurrent.body);
    assert.equal(first.json().state, 'running');
    assert.equal(first.json().instanceId, concurrent.json().instanceId);
    const base = first.json().url;
    const html = await f.app.inject({ method: 'GET', url: base });
    assert.equal(html.statusCode, 200, html.body);
    assert.ok(html.body.includes(`${base}src/main.tsx`));
    const source = await f.app.inject({ method: 'GET', url: `${base}src/main.tsx` });
    assert.equal(source.statusCode, 200, source.body);
    assert.match(source.body, /createRoot/);
    const proof = await f.app.inject({ method: 'GET', url: `${base}proof`, headers: { cookie: 'forma_session=platform-secret', authorization: 'Bearer platform-secret' } });
    assert.deepEqual(proof.json(), { projectConfiguration: true, cookie: null, authorization: null });
    const state = f.repository.applicationSyncStatus(f.project.id)!;
    const pageModule = await f.app.inject({ method: 'GET', url: base + state.sourceFiles[0].file });
    assert.equal(pageModule.statusCode, 200, pageModule.body);
    assert.match(pageModule.body, /来自实际业务源码/);
    assert.equal((await f.app.inject({ method: 'POST', url: `${runtime}/stop` })).json().state, 'stopped');
    assert.equal((await f.app.inject({ method: 'GET', url: base })).statusCode, 503);
    const restarted = await f.app.inject({ method: 'POST', url: `${runtime}/start` });
    assert.equal(restarted.statusCode, 200, restarted.body);
    assert.notEqual(restarted.json().instanceId, first.json().instanceId);
  } finally { await f.app.close(); }
});

test('启动失败有状态和日志，修复项目配置后可重试；纯原型不启动进程', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/projects/default-project/runtime/start' })).statusCode, 409);
    const config = resolve(f.directory, 'vite.config.ts');
    const original = readFileSync(config, 'utf8');
    writeFileSync(config, 'throw new Error("可定位的业务配置错误");\nexport default {};\n');
    const runtime = `/api/projects/${f.project.id}/runtime`;
    const failed = await f.app.inject({ method: 'POST', url: `${runtime}/start` });
    assert.equal(failed.statusCode, 503, failed.body);
    const state = (await f.app.inject({ method: 'GET', url: runtime })).json();
    assert.equal(state.state, 'error');
    assert.match(state.error, /可定位的业务配置错误/);
    assert.match(state.logs, /可定位的业务配置错误/);
    writeFileSync(config, original);
    const retried = await f.app.inject({ method: 'POST', url: `${runtime}/start` });
    assert.equal(retried.statusCode, 200, retried.body);
    assert.equal(retried.json().state, 'running');
  } finally { await f.app.close(); }
});

test('启动停止需要维护权限，页面与源码转发逐请求检查项目访问权限', async () => {
  const f = await fixture(true);
  const runtime = `/api/projects/${f.project.id}/runtime`;
  const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie = '', payload?: Record<string, unknown>) => f.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  try {
    assert.equal((await request('GET', runtime)).statusCode, 401);
    const user = (await request('POST', '/api/admin/users', f.admin, { username: 'viewer', password: 'password-123' })).json().user;
    const login = await request('POST', '/api/auth/login', '', { username: 'viewer', password: 'password-123' });
    const viewer = String(login.headers['set-cookie']).split(';')[0];
    const started = await request('POST', `${runtime}/start`, f.admin);
    assert.equal(started.statusCode, 200, started.body);
    const base = started.json().url;
    assert.equal((await request('GET', base)).statusCode, 401);
    assert.equal((await request('GET', base, viewer)).statusCode, 403);
    assert.equal((await request('GET', `${base}src/main.tsx`, viewer)).statusCode, 403);
    await request('PUT', `/api/projects/${f.project.id}/members/${user.id}`, f.admin, { role: 'viewer' });
    assert.equal((await request('GET', base, viewer)).statusCode, 200);
    assert.equal((await request('POST', `${runtime}/start`, viewer)).statusCode, 403);
    assert.equal((await request('POST', `${runtime}/stop`, viewer)).statusCode, 403);
    const removed = await request('PUT', `/api/projects/${f.project.id}/members/${user.id}`, f.admin, { role: null });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal((await request('GET', `${base}src/main.tsx`, viewer)).statusCode, 403);
  } finally { await f.app.close(); }
});
