import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
import { registerAi } from '../server/ai/routes';
import { registerAuth } from '../server/auth';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('原型和设计稿附图实际传给两种 CLI，校验修正和额度接续保留原图，拒绝路径与伪造图片', async () => {
  const keys = ['FORMA_CODEX_CLI', 'FORMA_CLAUDE_CLI', 'FORMA_AI_PROVIDER'] as const;
  const previous = keys.map(key => process.env[key]);
  process.env.FORMA_CODEX_CLI = process.env.FORMA_CLAUDE_CLI = resolve('tests/fixtures/fake-chat-image-model.mjs');
  process.env.FORMA_AI_PROVIDER = 'codex';
  const connection = openDatabase(':memory:'), repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); const auth = registerAuth(app, connection.db);
  registerApi(app, repository, auth); registerAi(app, connection.db, auth);
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } });
    const headers = { cookie: String(setup.headers['set-cookie']).split(';')[0], 'x-forma-client-id': randomUUID() };
    await app.inject({ method: 'POST', url: '/api/pages/default-page/lease', headers });
    const saved = repository.readDocument('default-page'); assert.ok(saved);
    const doc = saved.document;
    const board = repository.attachDesignBoard('default-project', 'default-page', '附图测试', doc).board;
    const prototype = '/api/pages/default-page/ai', design = `/api/pages/default-page/design/${board.id}/ai`;
    for (const endpoint of [prototype, design]) {
      const payload = { prompt: '分析图片', selectedIds: [], ...(endpoint === prototype ? { baseDocument: doc } : {}) };
      for (const invalid of ['C:/private.png', 'https://example.test/a.png', 'data:image/png;base64,YWJj', 'data:image/svg+xml;base64,PHN2Zz4=']) {
        const response = await app.inject({ method: 'POST', url: endpoint + '/turn', headers, payload: { ...payload, image: invalid } });
        assert.equal(response.statusCode, 400, response.body);
      }
      assert.equal((await app.inject({ method: 'GET', url: endpoint + '/messages', headers })).json().messages.length, 0);
      for (const provider of ['codex', 'claude', 'auto']) {
        process.env.FORMA_AI_PROVIDER = provider;
        const prompt = provider === 'auto' ? 'QUOTA 附图' : endpoint === prototype && provider === 'codex' ? '修正验证' : '分析图片';
        const response = await app.inject({ method: 'POST', url: endpoint + '/turn', headers, payload: { ...payload, prompt, image } });
        assert.equal(response.statusCode, 200, response.body);
        const events = response.body.trim().split('\n').map(line => JSON.parse(line));
        const result = events.find(event => event.type === 'result');
        assert.ok(result, response.body);
        assert.match(result.message.content, /已读取参考图片/);
        assert.equal(result.message.provider, provider === 'codex' ? 'codex' : 'claude');
        if (prompt === '修正验证') { assert.equal(result.changed, true); assert.ok(events.some(event => event.type === 'status' && event.text.includes('自动修正'))); }
      }
      const history = (await app.inject({ method: 'GET', url: endpoint + '/messages', headers })).json().messages;
      assert.equal(history.filter((message: { content: string }) => message.content.includes('[附图，仅供本轮参考]')).length, 3);
      assert.equal(JSON.stringify(history).includes('data:image'), false);
    }
    assert.deepEqual(repository.readDocument('default-page')?.document, doc, '模型结果仍需客户端应用，附图不修改画布');
  } finally {
    await app.close(); connection.close();
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
