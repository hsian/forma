import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
// @ts-expect-error Shared ZIP fixture.
import { sketchFixture } from './fixtures/sketch.mjs';

test('optional UI designs attach multiple Sketch boards without replacing the prototype; mode, copy and cascade are independent', async () => {
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); registerApi(app, repository);
  const root = '/api/projects/default-project/sketch';
  const original = repository.readDocument('default-page');
  try {
    assert.deepEqual(repository.designMetadata('default-page'), { uiDesignRequired: false, uiDesignCount: 0 });
    const mode = await app.inject({ method: 'PATCH', url: '/api/pages/default-page/design', payload: { required: true } });
    assert.equal(mode.statusCode, 200, mode.body);
    assert.equal(repository.designMetadata('default-page').uiDesignRequired, true);
    assert.deepEqual(repository.readDocument('default-page'), original);
    const foreign = repository.createProject('另一个项目');
    for (let index = 0; index < 2; index++) {
      const uploaded = await app.inject({ method: 'POST', url: root, headers: { 'content-type': 'application/octet-stream' }, payload: sketchFixture() });
      const token = uploaded.json().token;
      const payload = { pageId: 'p', boardId: 'board', targetPageId: foreign.page.id };
      assert.equal((await app.inject({ method: 'POST', url: `${root}/${token}/import`, payload })).statusCode, 400);
      const result = await app.inject({ method: 'POST', url: `${root}/${token}/import`, payload: { ...payload, targetPageId: 'default-page' } });
      assert.equal(result.statusCode, 200, result.body);
      assert.equal(result.json().page.id, 'default-page');
      assert.deepEqual(repository.readDocument('default-page'), original);
      const board = result.json().board;
      assert.equal(repository.readDesignBoard('default-page', board.id).document.elements[0].text, '导入的设计文字');
      assert.equal((await app.inject({ method: 'GET', url: `/api/pages/${foreign.page.id}/design/${board.id}` })).statusCode, 404);
    }
    assert.equal(repository.listPages('default-project').length, 1);
    assert.deepEqual(repository.designMetadata('default-page'), { uiDesignRequired: true, uiDesignCount: 2 });
    await app.inject({ method: 'PATCH', url: '/api/pages/default-page/design', payload: { required: false } });
    assert.equal(repository.designMetadata('default-page').uiDesignRequired, false);
    assert.equal(repository.listDesignBoards('default-page').length, 2, 'switching to components retains designs');
    const copy = repository.duplicatePage('default-page');
    assert.deepEqual(repository.designMetadata(copy.id), { uiDesignRequired: false, uiDesignCount: 2 });
    assert.notEqual(repository.listDesignBoards(copy.id)[0].id, repository.listDesignBoards('default-page')[0].id);
    repository.deletePage(copy.id);
    const remaining = connection.sqlite.prepare('SELECT count(*) AS count FROM page_design_boards WHERE page_id = ?').get(copy.id) as { count: number };
    assert.equal(remaining.count, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/pages/missing/design' })).statusCode, 404);
  } finally { await app.close(); connection.close(); }
});
