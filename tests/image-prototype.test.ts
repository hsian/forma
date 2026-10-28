import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerAuth } from '../server/auth';
import { registerApi } from '../server/api';
import { parseScreenshot } from '../server/ai/image-input';
import { generate } from '../server/ai/provider';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const image = 'data:image/png;base64,' + png;
test('图片输入校验格式、真实文件头、尺寸和像素上限，不接受路径及 URL', () => {
  assert.equal(parseScreenshot(image).width, 1);
  for (const input of ['https://example.test/a.png', 'C:/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,' + png, 'data:image/png;base64,YWJj', image + 'x']) assert.throws(() => parseScreenshot(input));
  const oversized = Buffer.from(png, 'base64'); oversized.writeUInt32BE(8001, 16);
  assert.throws(() => parseScreenshot('data:image/png;base64,' + oversized.toString('base64')), /尺寸/);
  // A minimal SOF header is sufficient to check JPEG dimension parsing.
  const jpeg = Buffer.from([255,216,255,192,0,8,8,0,100,0,200,0,255,217]);
  assert.equal(parseScreenshot('data:image/jpeg;base64,' + jpeg.toString('base64')).width, 200);
});

test('图片通过 Codex 附件和 Claude 多模态消息传递，额度接续仍保留原图', async () => {
  const keys = ['FORMA_CODEX_CLI', 'FORMA_CLAUDE_CLI', 'FORMA_AI_PROVIDER'];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.FORMA_CODEX_CLI = process.env.FORMA_CLAUDE_CLI = resolve('tests/fixtures/fake-image-model.mjs');
    process.env.FORMA_AI_PROVIDER = 'auto';
    for (const [prompt, provider] of [['重建', 'codex'], ['QUOTA', 'claude']]) {
      const result = await generate(prompt, new AbortController().signal, () => {}, () => {}, parseScreenshot(image));
      assert.equal(result.provider, provider); assert.equal(JSON.parse(result.raw).operations.length, 4);
    }
    process.env.FORMA_AI_PROVIDER = 'claude';
    assert.equal((await generate('重建', new AbortController().signal, () => {}, () => {}, parseScreenshot(image))).provider, 'claude');
  } finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

test('图片预览不写库，确认后原子创建新页，同名追加、权限和错误保护', async () => {
  const previous = [process.env.FORMA_CODEX_CLI, process.env.FORMA_AI_PROVIDER];
  process.env.FORMA_CODEX_CLI = resolve('tests/fixtures/fake-image-model.mjs'); process.env.FORMA_AI_PROVIDER = 'codex';
  const connection = openDatabase(':memory:'); const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); const auth = registerAuth(app, connection.db); registerApi(app, repository, auth);
  const base = '/api/projects/default-project/image-prototype';
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } });
    const cookie = String(setup.headers['set-cookie']).split(';')[0]; const headers = { cookie };
    const original = structuredClone(repository.readDocument('default-page'));
    const request = (path: string, payload: object, h = headers) => app.inject({ method: 'POST', url: base + path, headers: h, payload });
    assert.equal((await request('/generate', { image }, {} as typeof headers)).statusCode, 401);
    assert.equal((await request('/generate', { image: 'invalid' })).statusCode, 400);
    const generated = await request('/generate', { image, prompt: '修正' });
    const events = generated.body.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(e => e.type === 'status' && e.text.includes('修正')));
    const result = events.find(e => e.type === 'result'); assert.ok(result, generated.body);
    assert.equal(result.document.elements.length, 4);
    assert.equal(repository.listPages('default-project').length, 1);
    const clarify = await request('/generate', { image, prompt: '需要确认，滚动测试' });
    const question = clarify.body.trim().split('\n').map(line => JSON.parse(line)).find(e => e.type === 'clarification');
    assert.ok(question, clarify.body);
    assert.equal(clarify.body.includes('"type":"result"'), false, '有疑问时不能同时交付原型');
    assert.equal(repository.listPages('default-project').length, 1);
    assert.equal((await request('/generate', { image, prompt: '需要确认，滚动测试', analysisToken: question.analysisToken })).statusCode, 400);
    assert.equal((await request('/generate', { image, prompt: '已换说明', analysisToken: question.analysisToken, answers: { 'fixed-column': '右侧操作列固定' } })).statusCode, 409);
    const continued = await request('/generate', { image, prompt: '需要确认，滚动测试', analysisToken: question.analysisToken, answers: { 'fixed-column': '右侧操作列固定' } });
    const continuationEvents = continued.body.trim().split('\n').map(line => JSON.parse(line));
    const continuedResult = continuationEvents.find(e => e.type === 'result');
    assert.ok(continuedResult, continued.body);
    assert.equal(continuedResult.document.elements.find((e: { table?: unknown }) => e.table).table.scrollWidth, 1100);
    assert.equal(continuedResult.document.elements.some((e: { id: string }) => e.id === 'table_scroll_track'), false);
    assert.ok(continuationEvents.some(e => e.type === 'status' && e.text.includes('修正')), '伪滚动条必须走自动修正');
    assert.equal((await request('/generate', { image, prompt: '需要确认，滚动测试', analysisToken: question.analysisToken, answers: { 'fixed-column': '右侧操作列固定' } })).statusCode, 409, '已使用的分析标识不能重放');
    const requestId = crypto.randomUUID();
    const slow = request('/generate', { image, prompt: '延迟', requestId });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await request('/cancel', { requestId })).statusCode, 200);
    const immediateRetry = await request('/generate', { image });
    assert.equal(immediateRetry.statusCode, 200, immediateRetry.body);
    assert.ok(immediateRetry.body.includes('"type":"result"'));
    assert.ok((await slow).body.includes('"type":"error"'));
    for (const prompt of ['无结果', '始终非法']) {
      const failure = await request('/generate', { image, prompt });
      assert.ok(failure.body.includes('"type":"error"'), failure.body);
      assert.ok(failure.body.includes(prompt === '无结果' ? '没有生成可编辑' : '未通过校验'), failure.body);
      assert.equal(repository.listPages('default-project').length, 1);
    }
    assert.equal((await request('/import', { name: '图片迁移', document: { ...result.document, elements: [] } })).statusCode, 400);
    const created = await request('/import', { name: '图片迁移', document: result.document });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().page.id;
    assert.deepEqual(repository.readDocument(id)?.document.elements.find(e => e.kind === 'table')?.table?.rows, [{ name: '张三', status: '正常' }]);
    const copy = await request('/import', { name: '图片迁移', document: result.document });
    assert.equal(copy.json().page.name, '图片迁移 (2)');
    assert.deepEqual(repository.readDocument('default-page'), original);
    const account = (await app.inject({ method: 'POST', url: '/api/admin/users', headers, payload: { username: 'designer', password: 'password-123' } })).json().user;
    await app.inject({ method: 'PUT', url: `/api/projects/default-project/members/${account.id}`, headers, payload: { role: 'designer' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'designer', password: 'password-123' } });
    const member = { cookie: String(login.headers['set-cookie']).split(';')[0] };
    assert.ok((await request('/generate', { image }, member)).body.includes('"type":"result"'));
    const role = await app.inject({ method: 'POST', url: '/api/projects/default-project/roles', headers, payload: { name: '仅管理页面', description: '', permissions: ['prototype.read', 'page.manage'] } });
    assert.equal(role.statusCode, 200, role.body);
    await app.inject({ method: 'PUT', url: `/api/projects/default-project/members/${account.id}`, headers, payload: { role: role.json().id } });
    assert.equal((await request('/generate', { image }, member)).statusCode, 403, '有页面管理权但无编辑权仍不能调用模型');
    assert.equal((await request('/import', { name: '无权创建', document: result.document }, member)).statusCode, 403);
    await app.inject({ method: 'PUT', url: `/api/projects/default-project/members/${account.id}`, headers, payload: { role: 'viewer' } });
    assert.equal((await request('/generate', { image }, member)).statusCode, 403);
    assert.equal((await request('/import', { name: '无权创建', document: result.document }, member)).statusCode, 403);
  } finally {
    await app.close(); connection.close();
    ['FORMA_CODEX_CLI', 'FORMA_AI_PROVIDER'].forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
