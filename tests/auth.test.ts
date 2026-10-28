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

test('细分操作权限、自定义角色作用域、即时撤权与角色替换', async () => {
  const f = fixture();
  try {
    const admin = f.cookie(await f.request('POST', '/api/auth/setup', '', '', { username: 'admin', password: 'password-123' }));
    const account = (await f.request('POST', '/api/admin/users', admin, '', { username: 'designer', password: 'password-123' })).json().user;
    const member = f.cookie(await f.request('POST', '/api/auth/login', '', '', { username: 'designer', password: 'password-123' }));
    const base = '/api/projects/default-project';
    assert.equal((await f.request('GET', `${base}/roles`)).statusCode, 401);
    const input = { name: '定制设计角色', description: '编辑但不能删除页面或导入', permissions: ['prototype.read', 'prototype.edit', 'page.manage'] };
    const custom = await f.request('POST', `${base}/roles`, admin, '', input); assert.equal(custom.statusCode, 200, custom.body);
    const roleId = custom.json().id;
    assert.equal((await f.request('POST', `${base}/roles`, admin, '', { ...input, permissions: ['prototype.edit'] })).statusCode, 400);
    assert.equal((await f.request('POST', `${base}/roles`, admin, '', { ...input, permissions: ['prototype.read', 'member.manage'] })).statusCode, 400);
    assert.equal((await f.request('PUT', `${base}/members/${account.id}`, admin, '', { role: roleId })).statusCode, 200);
    const windowId = randomUUID();
    assert.equal((await f.request('POST', '/api/pages/default-page/lease', member, windowId)).statusCode, 200);
    assert.equal((await f.request('DELETE', '/api/pages/default-page', member, windowId)).statusCode, 403);
    assert.equal((await f.request('POST', `${base}/sketch`, member, '', {})).statusCode, 403);
    assert.equal((await f.request('POST', `${base}/versions`, member, '', {})).statusCode, 403);
    assert.equal((await f.request('POST', `${base}/roles`, member, '', input)).statusCode, 403);
    const other = (await f.request('POST', '/api/projects', admin, '', { name: '另一个项目' })).json().project.id;
    assert.equal((await f.request('PUT', `/api/projects/${other}/members/${account.id}`, admin, '', { role: roleId })).statusCode, 400);
    assert.equal((await f.request('PUT', `/api/projects/${other}/roles/${roleId}`, admin, '', input)).statusCode, 404);
    await f.request('PUT', `/api/projects/${other}/members/${account.id}`, admin, '', { role: 'admin' });
    assert.equal((await f.request('DELETE', `/api/projects/${other}`, member)).statusCode, 403, '新项目的普通项目管理员不能删除项目');
    const content = f.repository.readDocument('default-page')!;
    const update = await f.request('PUT', `${base}/roles/${roleId}`, admin, '', { ...input, revision: 1, permissions: ['prototype.read'] }); assert.equal(update.statusCode, 200, update.body);
    assert.equal((await f.request('PUT', `${base}/roles/${roleId}`, admin, '', { ...input, revision: 1 })).statusCode, 409, '旧配置不能覆盖其他管理员的新配置');
    assert.equal((await f.request('GET', '/api/pages/default-page/lease', admin)).json().lease.expiresAt, undefined);
    assert.equal((await f.request('PUT', '/api/pages/default-page/document', member, windowId, { document: content.document, revision: content.revision })).statusCode, 403);
    assert.equal((await f.request('DELETE', `${base}/roles/${roleId}`, admin, '', {})).statusCode, 400);
    assert.equal((await f.request('DELETE', `${base}/roles/${roleId}`, admin, '', { replacement: 'designer' })).statusCode, 200);
    assert.equal((await f.request('GET', `${base}/permissions`, member)).json().role.id, 'designer');
    assert.equal((await f.request('DELETE', `${base}/roles/viewer`, admin, '', { replacement: 'designer' })).statusCode, 404);
    assert.equal((await f.request('GET', `${base}/audit`, member)).statusCode, 403);
    const entries = (await f.request('GET', `${base}/audit`, admin)).json().entries;
    assert.ok(entries.some((entry: { action: string }) => entry.action === '删除角色'));
    assert.equal((await f.request('PUT', `${base}/members/${account.id}`, admin, '', { role: 'publisher' })).statusCode, 200);
    assert.equal((await f.request('GET', `${base}/permissions`, member)).json().permissions.includes('version.publish'), true);
    assert.equal((await f.request('DELETE', `${base}/versions/absent`, member)).statusCode, 403);
  } finally { await f.app.close(); }
});

test('账号停用、密码重置、创建项目资格及所有权转交保留授权边界', async () => {
  const f = fixture();
  try {
    const setup = await f.request('POST', '/api/auth/setup', '', '', { username: 'admin', password: 'password-123' });
    const admin = f.cookie(setup); const adminId = setup.json().user.id;
    const account = (await f.request('POST', '/api/admin/users', admin, '', { username: 'member', password: 'password-123' })).json().user;
    let member = f.cookie(await f.request('POST', '/api/auth/login', '', '', { username: 'member', password: 'password-123' }));
    const path = `/api/admin/users/${account.id}`;
    await f.request('PUT', `/api/projects/default-project/members/${account.id}`, admin, '', { role: 'editor' });
    assert.equal((await f.request('PATCH', path, member, '', { enabled: false })).statusCode, 403);
    assert.equal((await f.request('PATCH', `/api/admin/users/${adminId}`, admin, '', { enabled: false })).statusCode, 400);
    await f.request('PATCH', path, admin, '', { canCreateProject: false });
    assert.equal((await f.request('POST', '/api/projects', member, '', { name: '禁止创建' })).statusCode, 403);
    const client = randomUUID(); await f.request('POST', '/api/pages/default-page/lease', member, client);
    assert.equal((await f.request('PATCH', path, admin, '', { enabled: false })).statusCode, 200);
    assert.equal((await f.request('GET', '/api/projects', member)).statusCode, 401);
    assert.equal((await f.request('GET', '/api/pages/default-page/lease', admin)).json().lease.expiresAt, undefined);
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'member', password: 'password-123' })).statusCode, 401);
    await f.request('PATCH', path, admin, '', { enabled: true });
    member = f.cookie(await f.request('POST', '/api/auth/login', '', '', { username: 'member', password: 'password-123' }));
    assert.equal((await f.request('POST', '/api/projects/default-project/owner', member, '', { userId: account.id })).statusCode, 403);
    assert.equal((await f.request('POST', '/api/projects/default-project/owner', admin, '', { userId: account.id })).statusCode, 200);
    assert.equal((await f.request('GET', '/api/projects/default-project/permissions', member)).json().role.id, 'admin');
    assert.equal((await f.request('PUT', `/api/projects/default-project/members/${account.id}`, admin, '', { role: 'viewer' })).statusCode, 400);
    assert.equal((await f.request('PATCH', path, admin, '', { password: 'new-password-123' })).statusCode, 200);
    assert.equal((await f.request('GET', '/api/projects', member)).statusCode, 401);
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'member', password: 'password-123' })).statusCode, 401);
    assert.equal((await f.request('POST', '/api/auth/login', '', '', { username: 'member', password: 'new-password-123' })).statusCode, 200);
    assert.equal((await f.request('GET', '/api/admin/users', member)).statusCode, 401);
    const entries = (await f.request('GET', '/api/admin/audit', admin)).json().entries;
    assert.ok(entries.some((entry: { action: string }) => entry.action === '重置密码'));
    assert.ok(!JSON.stringify(entries).includes('new-password-123'));
    assert.ok(!(await f.request('GET', '/api/admin/users', admin)).body.includes('passwordHash'));
  } finally { await f.app.close(); }
});

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
    assert.equal((await f.request('GET', `/api/bootstrap?projectId=${own.json().project.id}&pageId=default-page`, reader)).json().project.id, own.json().project.id, '指定项目优先于其他项目的历史页面');
    assert.equal((await f.request('GET', '/api/bootstrap?projectId=missing&pageId=default-page', reader)).statusCode, 404);
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
