import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerAuth } from '../server/auth';
import { registerApi } from '../server/api';
import { registerAi } from '../server/ai/routes';
import { users, sessions, projects, aiMessages } from '../server/db/schema';

function fixture() {
  const connection = openDatabase(':memory:'); const repository = createRepository(connection.db); repository.initialize();
  let time = Date.now(); const app = Fastify(); const auth = registerAuth(app, connection.db, () => time);
  registerApi(app, repository, auth); registerAi(app, connection.db, auth);
  app.addHook('onClose', async () => connection.close());
  const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, cookie = '', client = '', payload?: Record<string, unknown>, extra = {}) => app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(client ? { 'x-forma-client-id': client } : {}), ...extra }, ...(payload === undefined ? {} : { payload }) });
  const cookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  return { app, connection, repository, request, cookie, advance: (amount: number) => { time += amount; } };
}

test('首次初始化并发只产生一个管理员，接管现有项目并保留原型，关闭后续公开注册', async () => {
  const f = fixture();
  try {
    const before = f.repository.readDocument('default-page');
    assert.equal((await f.request('GET', '/api/bootstrap')).statusCode, 401);
    assert.equal((await f.request('GET', '/api/auth/status')).json().setupRequired, true);
    const setup = await Promise.all(['Alice', 'Bob'].map(username => f.request('POST', '/api/auth/setup', '', '', { username, password: 'password-123' })));
    assert.deepEqual(setup.map(response => response.statusCode).sort(), [200, 409]);
    const winner = setup.find(response => response.statusCode === 200)!;
    assert.equal(f.connection.db.select().from(users).all().length, 1);
    const user = winner.json().user; assert.equal(user.role, 'admin');
    assert.equal(f.connection.db.select().from(projects).get()!.ownerId, user.id);
    assert.deepEqual(f.repository.readDocument('default-page'), before);
    const stored = f.connection.db.select().from(users).get()!; assert.notEqual(stored.passwordHash, 'password-123');
    const token = f.cookie(winner).split('=')[1]; assert.notEqual(f.connection.db.select().from(sessions).get()!.tokenHash, token);
    assert.match(String(winner.headers['set-cookie']), /HttpOnly/); assert.match(String(winner.headers['set-cookie']), /SameSite=Strict/);
    assert.equal((await f.request('GET', '/api/bootstrap', f.cookie(winner))).json().projectRole, 'admin');
    assert.equal((await f.request('POST', '/api/auth/setup', '', '', { username: 'another', password: 'password-123' })).statusCode, 409);
    await f.request('POST', '/api/auth/logout', f.cookie(winner));
    assert.equal((await f.request('GET', '/api/projects', f.cookie(winner))).statusCode, 401);
    const login = await f.request('POST', '/api/auth/login', '', '', { username: user.username.toUpperCase(), password: 'password-123' });
    assert.equal(login.statusCode, 200); assert.notEqual(f.cookie(login), f.cookie(winner));
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: user.username, password: 'wrong-password' })).statusCode, 401);
    f.advance(7 * 86400000 + 1); assert.equal((await f.request('GET', '/api/projects', f.cookie(login))).statusCode, 401);
  } finally { await f.app.close(); }
});

test('项目权限服务端隔离，成员不能提权，只读不能保存或调用 AI，创建项目自动归属自己', async () => {
  const f = fixture();
  try {
    const admin = f.cookie(await f.request('POST', '/api/auth/setup', '', '', { username: 'admin', password: 'password-123' }));
    const created = await f.request('POST', '/api/admin/users', admin, '', { username: 'reader', password: 'password-123', role: 'admin' });
    assert.equal(created.json().user.role, 'member'); const readerId = created.json().user.id;
    const reader = f.cookie(await f.request('POST', '/api/auth/login', '', '', { username: 'reader', password: 'password-123' }));
    assert.deepEqual((await f.request('GET', '/api/projects', reader)).json().projects, []);
    assert.equal((await f.request('GET', '/api/pages/default-page/document', reader)).statusCode, 403);
    assert.equal((await f.request('POST', '/api/admin/users', reader, '', { username: 'evil', password: 'password-123' })).statusCode, 403);
    await f.request('PUT', `/api/projects/default-project/members/${readerId}`, admin, '', { role: 'viewer' });
    assert.equal((await f.request('GET', '/api/pages/default-page/document', reader)).statusCode, 200);
    for (const [method, path] of [['POST', '/api/pages/default-page/lease'], ['PUT', '/api/pages/default-page/document'], ['POST', '/api/pages/default-page/ai/turn'], ['PATCH', '/api/pages/default-page'], ['DELETE', '/api/projects/default-project']] as const)
      assert.equal((await f.request(method, path, reader, randomUUID(), {})).statusCode, 403, path);
    assert.equal((await f.request('GET', '/api/projects/default-project/members', reader)).statusCode, 403);
    await f.request('PUT', `/api/projects/default-project/members/${readerId}`, admin, '', { role: 'editor' });
    const readerWindow = randomUUID(); await f.request('POST', '/api/pages/default-page/lease', reader, readerWindow);
    await f.request('PUT', `/api/projects/default-project/members/${readerId}`, admin, '', { role: 'viewer' });
    assert.equal((await f.request('GET', '/api/pages/default-page/lease', admin)).json().lease.expiresAt, undefined, '降为只读时立即释放编辑权');
    const own = await f.request('POST', '/api/projects', reader, '', { name: '个人项目' }); assert.equal(own.statusCode, 200);
    assert.equal((await f.request('GET', `/api/bootstrap?pageId=${own.json().page.id}`, reader)).json().projectRole, 'admin');
    const adminId = (await f.request('GET', '/api/auth/status', admin)).json().user.id;
    assert.equal((await f.request('PUT', `/api/projects/default-project/members/${adminId}`, admin, '', { role: null })).statusCode, 400);
    assert.equal((await f.request('POST', '/api/projects', admin, '', { name: '恶意来源' }, { origin: 'https://evil.example' })).statusCode, 403);
    assert.equal((await f.request('GET', '/api/pages/default-page/ai/messages')).statusCode, 401);
  } finally { await f.app.close(); }
});

test('AI 生成期间编辑权发生变化，整轮结果被拒绝且不修改页面', async () => {
  const f = fixture(); const keys = ['FORMA_AI_PROVIDER', 'FORMA_CODEX_CLI']; const previous = keys.map(key => process.env[key]);
  try {
    process.env.FORMA_AI_PROVIDER = 'codex'; process.env.FORMA_CODEX_CLI = resolve('tests/fixtures/fake-model.mjs');
    const cookie = f.cookie(await f.request('POST', '/api/auth/setup', '', '', { username: 'admin', password: 'password-123' }));
    const a = randomUUID(), b = randomUUID(); await f.request('POST', '/api/pages/default-page/lease', cookie, a);
    const document = f.repository.readDocument('default-page')!.document;
    const pending = f.request('POST', '/api/pages/default-page/ai/turn', cookie, a, { prompt: '延迟修改按钮颜色', selectedIds: ['query'], baseDocument: document });
    for (let attempt = 0; attempt < 200 && !f.connection.db.select().from(aiMessages).all().some(message => message.status === 'running'); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    await f.request('DELETE', '/api/pages/default-page/lease', cookie, a);
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', cookie, b)).statusCode, 200);
    const result = await pending; const events = result.body.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.some(event => event.type === 'result'), false);
    assert.ok(events.some(event => event.type === 'error' && event.text.includes('编辑权或项目权限已变化')));
    assert.deepEqual(f.repository.readDocument('default-page')!.document, document);
  } finally { keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); await f.app.close(); }
});

test('页面编辑权绑定用户、Session 和窗口，心跳续期、超时释放、退出登录释放，版本保护继续生效', async () => {
  const f = fixture();
  try {
    const a = f.cookie(await f.request('POST', '/api/auth/setup', '', '', { username: 'admin', password: 'password-123' }));
    const b = f.cookie(await f.request('POST', '/api/auth/login', '', '', { username: 'admin', password: 'password-123' }));
    const ca = randomUUID(), cb = randomUUID();
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', a, ca)).json().lease.owned, true);
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', a, cb)).statusCode, 423);
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', b, ca)).statusCode, 423);
    const content = f.repository.readDocument('default-page')!;
    assert.equal((await f.request('PUT', '/api/pages/default-page/document', b, cb, content)).statusCode, 423);
    assert.equal((await f.request('PUT', '/api/pages/default-page/document', a, ca, { revision: content.revision, document: content.document })).statusCode, 200);
    assert.equal((await f.request('PUT', '/api/pages/default-page/document', a, ca, { revision: content.revision, document: content.document })).statusCode, 409);
    f.advance(60000); await f.request('POST', '/api/pages/default-page/lease', a, ca);
    f.advance(60000); assert.equal((await f.request('POST', '/api/pages/default-page/lease', b, cb)).statusCode, 423);
    await f.request('DELETE', '/api/pages/default-page/lease', b, cb); assert.equal((await f.request('GET', '/api/pages/default-page/lease', a, ca)).json().lease.owned, true);
    await f.request('POST', '/api/auth/logout', a); assert.equal((await f.request('POST', '/api/pages/default-page/lease', b, cb)).statusCode, 200);
    f.advance(90001); assert.equal((await f.request('POST', '/api/pages/default-page/lease', b, ca)).statusCode, 200);
    assert.equal((await f.request('PUT', '/api/pages/default-page/document', b, cb, content)).statusCode, 423);
    await f.request('DELETE', '/api/pages/default-page/lease', b, ca);
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', b, cb)).statusCode, 200);
  } finally { await f.app.close(); }
});

test('登录错误有速率限制，未授权的读取与写入不会进入业务接口', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 15; i++) assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'absent', password: 'password-123' })).statusCode, 401);
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'absent', password: 'password-123' })).statusCode, 429);
    f.advance(15 * 60000 + 1);
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'absent', password: 'password-123' })).statusCode, 401);
  } finally { await f.app.close(); }
});
