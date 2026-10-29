import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolve } from 'node:path';
import { openDatabase } from '../server/db/index.js';
import { createRepository } from '../server/db/repository.js';
import { registerAuth } from '../server/auth.js';
import { registerApi } from '../server/api.js';
import { makeElement } from '../shared/model.js';
import { mcpConnectionConfig } from '../shared/mcp-connection.js';
import { bindingFromEnv, PrototypeClient } from '../server/mcp/client.js';
import { createPrototypeMcp } from '../server/mcp/server.js';

test('MCP 免登录读取固定版本、目录/搜索/详情分页，版本删除失效且其他接口仍鉴权', async () => {
  const db = openDatabase(':memory:'), repository = createRepository(db.db); repository.initialize();
  const app = Fastify(); registerApi(app, repository, registerAuth(app, db.db));
  const original = repository.readDocument('default-page')!;
  const doc = structuredClone(original.document);
  doc.elements.push({ ...makeElement('inputNumber'), id: 'expiry', name: '有效期', text: '账号有效期', required: true, component: { min: 1, max: 365 } });
  doc.elements.push({ ...makeElement('text'), id: 'large', text: '长'.repeat(70000) });
  doc.annotations = [{ id: 'rule', number: 1, x: 1, y: 1, title: '登录规则', content: '过期后禁止登录' }];
  repository.saveDocument('default-page', original.revision, doc);
  const child = repository.createPage('default-project', '子页面', 'default-page');
  const version = repository.createVersion('default-project', 'MCP V1', '固定版本', 'admin', repository.draftVersionManifest('default-project').stamp).version;
  // Later draft edits/deletions must not leak into the bound snapshot.
  repository.saveDocument('default-page', original.revision + 1, { ...doc, elements: [] });
  repository.deletePage(child.id);
  const paths: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.headers, undefined);
    assert.equal(init?.method, undefined);
    const res = await app.inject({ method: 'GET', url: path });
    return new Response(res.body, { status: res.statusCode, headers: res.headers as Record<string, string> });
  };
  const binding = { url: 'http://forma.test', projectId: 'default-project', versionId: version.id };
  const server = createPrototypeMcp(new PrototypeClient(binding, fetcher));
  const client = new Client({ name: 'test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => await client.callTool({ name, arguments: args });
  try {
    const tools = (await client.listTools()).tools;
    assert.deepEqual(tools.map(t => t.name).sort(), ['get_node', 'get_outline', 'get_page', 'search_prototype']);
    assert.ok(tools.every(t => t.annotations?.readOnlyHint));
    const outline = await call('get_outline', { limit: 1 });
    const info = outline.structuredContent as any;
    assert.equal(info.version.id, version.id); assert.equal(info.pages.total, 2); assert.equal(info.pages.nextOffset, 1);
    const page = (await call('get_page', { pageId: 'default-page', limit: 1 })).structuredContent as any;
    assert.equal(page.nodes.total, doc.elements.length); assert.equal(page.annotations.items[0].content, '过期后禁止登录');
    const node = (await call('get_node', { pageId: 'default-page', nodeId: 'expiry' })).structuredContent as any;
    assert.equal(node.node.required, true); assert.equal(node.node.component.max, 365);
    assert.equal(node.node.fill, undefined); assert.equal(node.node.x, undefined);
    const modal = (await call('get_node', { pageId: 'default-page', nodeId: 'add' })).structuredContent as any;
    assert.ok(modal.references.some((r: any) => r.id === doc.dialogs![0].id));
    const dialog = (await call('get_node', { pageId: 'default-page', nodeId: doc.dialogs![0].id, limit: 1 })).structuredContent as any;
    assert.ok(dialog.children.nextOffset);
    const batch = (await call('search_prototype', { query: '过期', pageLimit: 1 })).structuredContent as any;
    assert.equal(batch.scannedPageIds.length, 1); assert.equal(batch.nextPageOffset, 1);
    const search = (await call('search_prototype', { query: '过期', pageId: 'default-page' })).structuredContent as any;
    assert.equal(search.matches.items[0].nodeId, 'rule');
    assert.equal((await call('get_node', { pageId: 'default-page', nodeId: 'large' })).isError, true);
    const chunk = (await call('get_node', { pageId: 'default-page', nodeId: 'large', section: 'text', offset: 200, limit: 1 })).structuredContent as any;
    assert.equal(chunk.text.length, 100); assert.equal(chunk.nextOffset, 300);
    assert.equal((await call('get_page', { pageId: 'missing' })).isError, true);
    assert.equal((await call('get_outline', { limit: -1 })).isError, true);
    assert.ok(paths.every(path => path.startsWith(`/api/mcp/projects/default-project/versions/${version.id}`)));
    for (const url of ['/api/projects', '/api/users', '/api/pages/default-page/document', `/api/projects/default-project/versions/${version.id}`, '/api/mcp/projects', '/api/mcp/projects/default-project/versions', `/api/mcp/projects/default-project/versions/${version.id}/export.html`]) {
      assert.equal((await app.inject({ url })).statusCode, 401, url);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      assert.equal((await app.inject({ method, url: `/api/mcp/projects/default-project/versions/${version.id}` })).statusCode, 401);
      assert.equal((await app.inject({ method, url: `/api/mcp/projects/default-project/versions/${version.id}/pages/default-page` })).statusCode, 401);
    }
    const other = repository.createProject('另一个项目');
    assert.equal((await app.inject(`/api/mcp/projects/${other.project.id}/versions/${version.id}`)).statusCode, 404);
    repository.deleteVersion('default-project', version.id);
    const deleted = await call('get_outline'); assert.equal(deleted.isError, true); assert.match(JSON.stringify(deleted.content), /不会切换/);
  } finally { await client.close(); await server.close(); await app.close(); db.close(); }
});

test('MCP stdio 进程可握手和发现工具，配置不依赖开发工具当前目录', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('node_modules/tsx/dist/cli.mjs'), resolve('server/mcp/index.ts')], cwd: process.env.TEMP || 'C:/Windows/Temp', env: { ...process.env as Record<string, string>, FORMA_URL: 'http://127.0.0.1:1', FORMA_PROJECT_ID: 'p', FORMA_VERSION_ID: 'v' }, stderr: 'pipe' });
  const client = new Client({ name: 'stdio-test', version: '1' });
  try { await client.connect(transport); assert.equal((await client.listTools()).tools.length, 4); }
  finally { await client.close(); }
  const config = mcpConnectionConfig('http://server:6060/', 'p', 'v');
  const json = JSON.parse(config.claude).mcpServers.forma_prototype;
  assert.deepEqual(json, { type: 'http', url: 'http://server:6060/mcp' });
  assert.equal(new URL(config.previewUrl).searchParams.get('versionId'), 'v');
  assert.equal(config.endpoint, json.url);
  assert.match(config.codex, /\[mcp_servers.forma_prototype\]/);
  assert.equal(config.codex.includes('command'), false);
  assert.deepEqual(bindingFromEnv({ FORMA_URL: 'http://server:6060', FORMA_PROJECT_ID: 'p', FORMA_VERSION_ID: 'v' }), { url: 'http://server:6060', projectId: 'p', versionId: 'v' });
  assert.throws(() => bindingFromEnv({}), /FORMA_URL/);
  assert.throws(() => bindingFromEnv({ FORMA_URL: 'https://user:secret@host/' }), /服务根地址/);
});

test('HTTP MCP 仅用 URL 完成 SDK 握手和工具调用，多版本并发隔离、删除即时生效', async () => {
  const db = openDatabase(':memory:'), repository = createRepository(db.db); repository.initialize();
  const app = Fastify(); registerApi(app, repository, registerAuth(app, db.db));
  const version = repository.createVersion('default-project', 'HTTP V1', '', 'test', repository.draftVersionManifest('default-project').stamp).version;
  const original = repository.readDocument('default-page')!;
  const doc = structuredClone(original.document); doc.elements.find(e => e.id === 'title')!.text = '新版用户管理';
  repository.saveDocument('default-page', original.revision, doc);
  const newer = repository.createVersion('default-project', 'HTTP V2', '', 'test', repository.draftVersionManifest('default-project').stamp).version;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const headers = new Headers(init?.headers); headers.set('host', url.host);
    assert.equal(headers.has('authorization'), false); assert.equal(headers.has('cookie'), false);
    const result = await app.inject({ method: (init?.method || 'GET') as 'POST' | 'GET', url: url.pathname, headers: Object.fromEntries(headers), payload: init?.body as string });
    return new Response(result.body || null, { status: result.statusCode, headers: result.headers as Record<string, string> });
  };
  const endpoint = (versionId: string) => `http://forma.test/api/mcp/projects/default-project/versions/${versionId}/mcp`;
  const clients = [new Client({ name: 'a', version: '1' }), new Client({ name: 'b', version: '1' }), new Client({ name: 'unified', version: '1' })];
  try {
    await Promise.all(clients.map((client, i) => client.connect(new StreamableHTTPClientTransport(new URL(i === 2 ? 'http://forma.test/mcp' : endpoint(i ? newer.id : version.id)), { fetch: fetcher }))));
    assert.equal((await clients[0].listTools()).tools.length, 4);
    const results = await Promise.all(clients.slice(0, 2).map(client => client.callTool({ name: 'get_node', arguments: { pageId: 'default-page', nodeId: 'title' } })));
    assert.equal((results[0].structuredContent as any).node.text, '用户管理');
    assert.equal((results[1].structuredContent as any).node.text, '新版用户管理');
    assert.equal((results[0].structuredContent as any).version.id, version.id);
    const unified = clients[2];
    const tools = (await unified.listTools()).tools;
    assert.equal(tools.length, 5); assert.ok(tools.every(tool => tool.inputSchema.required?.includes('prototypeUrl')));
    const link = (versionId: string, projectId = 'default-project', pageId = 'default-page') => `http://localhost:6060/preview?${new URLSearchParams({ projectId, versionId, pageId })}`;
    const resolve = await unified.callTool({ name: 'resolve_prototype', arguments: { prototypeUrl: link(version.id) } });
    assert.equal((resolve.structuredContent as any).selectedPage.id, 'default-page');
    const parallel = await Promise.all([version.id, newer.id].map(versionId => unified.callTool({ name: 'get_node', arguments: { prototypeUrl: link(versionId), nodeId: 'title' } })));
    assert.equal((parallel[0].structuredContent as any).node.text, '用户管理');
    assert.equal((parallel[1].structuredContent as any).node.text, '新版用户管理');
    const other = repository.createProject('另一个项目');
    const otherVersion = repository.createVersion(other.project.id, '其他版本', '', 'test', repository.draftVersionManifest(other.project.id).stamp).version;
    const otherResult = await unified.callTool({ name: 'get_outline', arguments: { prototypeUrl: link(otherVersion.id, other.project.id, other.page.id) } });
    assert.equal((otherResult.structuredContent as any).project.id, other.project.id);
    for (const prototypeUrl of ['http://localhost:6060/preview?projectId=default-project', link(version.id) + '&versionId=duplicate', link(version.id, other.project.id, other.page.id), link(version.id, 'default-project', 'missing'), 'file:///preview?projectId=p&versionId=v']) {
      assert.equal((await unified.callTool({ name: 'resolve_prototype', arguments: { prototypeUrl } })).isError, true, prototypeUrl);
    }
    assert.equal((await unified.callTool({ name: 'get_outline', arguments: {} })).isError, true, '不记忆上一次选择');
    assert.equal((await app.inject({ url: '/mcp' })).statusCode, 405);
    assert.equal((await app.inject({ method: 'POST', url: '/mcp', headers: { origin: 'http://evil.test' }, payload: {} })).statusCode, 403);
    const path = new URL(endpoint(version.id)).pathname;
    assert.equal((await app.inject({ url: path })).statusCode, 405);
    assert.equal((await app.inject({ method: 'DELETE', url: path })).statusCode, 405);
    assert.equal((await app.inject({ method: 'PUT', url: path })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: path, headers: { origin: 'http://evil.test' }, payload: {} })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/projects/default-project/versions', payload: {} })).statusCode, 401);
    const invalid = await app.inject({ method: 'POST', url: path, headers: { accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 7, method: 'not-real' } });
    assert.equal(invalid.statusCode, 200); assert.ok(invalid.json().error);
    repository.deleteVersion('default-project', version.id);
    assert.equal((await unified.callTool({ name: 'get_outline', arguments: { prototypeUrl: link(version.id) } })).isError, true);
    assert.equal((await clients[0].callTool({ name: 'get_outline', arguments: {} })).isError, true);
    assert.equal((await clients[1].callTool({ name: 'get_outline', arguments: {} })).isError, undefined);
  } finally { await Promise.all(clients.map(client => client.close())); await app.close(); db.close(); }
});
