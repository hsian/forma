import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerConversations } from '../server/ai/conversations';
import { registerAuth } from '../server/auth';
import { registerAi } from '../server/ai/routes';
import { aiMessages, aiConversations } from '../server/db/schema';

test('AI receives only the active conversation and rejects a stale conversation identifier', async () => {
  const previous = [process.env.FORMA_AI_PROVIDER, process.env.FORMA_CODEX_CLI];
  process.env.FORMA_AI_PROVIDER = 'codex'; process.env.FORMA_CODEX_CLI = resolve('tests/fixtures/fake-model.mjs');
  const connection = openDatabase(':memory:'); const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); registerAi(app, connection.db);
  const endpoint = '/api/pages/default-page/ai';
  async function turn(conversationId: string | null) {
    const response = await app.inject({ method: 'POST', url: endpoint + '/turn', payload: { conversationId, prompt: '历史计数测试', selectedIds: [], baseDocument: repository.readDocument('default-page')!.document } });
    assert.equal(response.statusCode, 200, response.body);
    return response.body.trim().split('\n').map(line => JSON.parse(line)).find(event => event.type === 'result')?.message.content;
  }
  try {
    assert.equal(await turn(null), '历史消息数：0');
    const first = (await app.inject({ method: 'GET', url: endpoint + '/messages' })).json().conversation;
    assert.equal(await turn(first.id), '历史消息数：2');
    const next = (await app.inject({ method: 'POST', url: endpoint + '/conversations' })).json().conversation;
    assert.equal(await turn(next.id), '历史消息数：0');
    const stale = await app.inject({ method: 'POST', url: endpoint + '/turn', payload: { conversationId: first.id, prompt: '旧窗口', selectedIds: [], baseDocument: repository.readDocument('default-page')!.document } });
    assert.equal(stale.statusCode, 409);
    await app.inject({ method: 'POST', url: endpoint + `/conversations/${first.id}/restore` });
    assert.equal(await turn(first.id), '历史消息数：4');
  } finally {
    await app.close(); connection.close();
    ['FORMA_AI_PROVIDER', 'FORMA_CODEX_CLI'].forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test('conversation lifecycle isolates history, paginates tied timestamps, guards active generation and preserves documents', async () => {
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); const active = new Map<string, AbortController>();
  const chats = registerConversations(app, connection.db, active);
  const endpoint = '/api/pages/default-page/ai/conversations';
  const original = repository.readDocument('default-page');
  try {
    const first = (await app.inject({ method: 'POST', url: endpoint })).json().conversation;
    connection.db.insert(aiMessages).values(Array.from({ length: 85 }, (_, index) => ({ id: `message-${String(index).padStart(3, '0')}`, pageId: 'default-page', conversationId: first.id, role: 'user' as const, content: `内容${index}`, status: 'done', provider: '', createdAt: 1000 }))).run();
    assert.equal(chats.history('default-page').length, 80);
    const second = (await app.inject({ method: 'POST', url: endpoint })).json().conversation;
    assert.notEqual(first.id, second.id); assert.deepEqual(chats.history('default-page'), []);
    assert.equal((await app.inject({ method: 'POST', url: endpoint })).json().conversation.id, second.id, 'empty chat is reused');
    assert.equal((await app.inject({ method: 'GET', url: endpoint })).json().conversations[0].id, first.id);
    const ids: string[] = []; let cursor = '';
    for (;;) {
      const result = (await app.inject({ method: 'GET', url: `${endpoint}/${first.id}/messages${cursor ? `?beforeId=${cursor}` : ''}` })).json();
      ids.push(...result.messages.map((m: { id: string }) => m.id));
      if (!result.more) break; cursor = result.messages[0].id;
    }
    assert.equal(ids.length, 85); assert.equal(new Set(ids).size, 85);
    active.set('default-page', new AbortController());
    for (const [method, path] of [['POST', ''], ['POST', `/${first.id}/restore`], ['DELETE', `/${first.id}`], ['DELETE', '']] as const) {
      assert.equal((await app.inject({ method, url: endpoint + path })).statusCode, 409);
    }
    active.clear();
    assert.equal((await app.inject({ method: 'POST', url: `${endpoint}/${first.id}/restore` })).statusCode, 200);
    assert.equal(chats.current('default-page')?.id, first.id); assert.equal(chats.history('default-page').length, 80);
    const other = repository.createProject('另一个项目');
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/pages/${other.page.id}/ai/conversations/${first.id}` })).statusCode, 404);
    for (let index = 0; index < 23; index++) connection.db.insert(aiConversations).values({ id: `archive-${index}`, pageId: 'default-page', title: '归档', archived: true, createdAt: index }).run();
    assert.equal((await app.inject({ method: 'GET', url: endpoint })).json().conversations.length, 20);
    assert.equal((await app.inject({ method: 'GET', url: endpoint + '?page=2' })).json().conversations.length, 3);
    await app.inject({ method: 'DELETE', url: `${endpoint}/${first.id}` });
    assert.equal(connection.db.select().from(aiMessages).all().length, 0, 'deleting chat cascades messages');
    await app.inject({ method: 'DELETE', url: endpoint });
    assert.equal(connection.db.select().from(aiConversations).all().length, 0);
    assert.deepEqual(repository.readDocument('default-page'), original);
  } finally { await app.close(); connection.close(); }
});

test('legacy chat migration preserves every message and attaches it to the current conversation', () => {
  const connection = openDatabase(':memory:');
  try {
    const repository = createRepository(connection.db); repository.initialize();
    connection.sqlite.exec('DROP TABLE ai_messages; DROP TABLE ai_conversations; CREATE TABLE ai_messages (id text PRIMARY KEY, page_id text, role text, content text, status text, provider text, created_at integer)');
    connection.sqlite.prepare('INSERT INTO ai_messages VALUES (?, ?, ?, ?, ?, ?, ?)').run('old', 'default-page', 'user', '旧需求', 'done', '', 10);
    connection.sqlite.exec(readFileSync('drizzle/0014_ai_conversations.sql', 'utf8'));
    assert.equal(connection.db.select().from(aiMessages).all()[0].content, '旧需求');
    assert.equal(connection.db.select().from(aiMessages).all()[0].conversationId, 'legacy-default-page');
    assert.equal(connection.db.select().from(aiConversations).all()[0].archived, false);
  } finally { connection.close(); }
});

test('conversation mutations require authentication, edit permission and page lease', async () => {
  const connection = openDatabase(':memory:'); const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); registerAuth(app, connection.db); registerConversations(app, connection.db, new Map());
  const endpoint = '/api/pages/default-page/ai/conversations';
  try {
    assert.equal((await app.inject({ method: 'POST', url: endpoint })).statusCode, 401);
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const headers = { cookie, 'x-forma-client-id': crypto.randomUUID() };
    assert.equal((await app.inject({ method: 'POST', url: endpoint, headers })).statusCode, 423);
    assert.equal((await app.inject({ method: 'POST', url: '/api/pages/default-page/lease', headers })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: endpoint, headers })).statusCode, 200);
    const user = (await app.inject({ method: 'POST', url: '/api/admin/users', headers, payload: { username: 'viewer', password: 'password-123' } })).json().user;
    await app.inject({ method: 'PUT', url: `/api/projects/default-project/members/${user.id}`, headers, payload: { role: 'viewer' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'viewer', password: 'password-123' } });
    const viewer = { cookie: String(login.headers['set-cookie']).split(';')[0] };
    assert.equal((await app.inject({ method: 'GET', url: endpoint, headers: viewer })).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: endpoint, headers: viewer })).statusCode, 403);
  } finally { await app.close(); connection.close(); }
});
