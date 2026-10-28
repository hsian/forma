import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProduction, resolveDatabasePath } from '../server/db/config';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';

test('开发与生产默认数据库分离，显式开发参数不受 NODE_ENV=production 影响', () => {
  const dev = fileURLToPath(new URL('../data/forma.dev.db', import.meta.url));
  const prod = fileURLToPath(new URL('../data/forma.db', import.meta.url));
  assert.equal(resolveDatabasePath({}, []), dev);
  assert.equal(resolveDatabasePath({}, ['--production']), prod);
  assert.equal(resolveDatabasePath({ NODE_ENV: 'production' }, []), prod);
  assert.equal(resolveDatabasePath({ NODE_ENV: 'production' }, ['--development']), dev);
  assert.equal(isProduction({ NODE_ENV: 'production' }, ['--development']), false);
  assert.notEqual(dev, prod);
});

test('测试运行器的显式数据库及内存数据库始终优先，不退回工作库', () => {
  const path = resolve('test-results/example-isolated.db');
  for (const args of [[], ['--development'], ['--production']]) assert.equal(resolveDatabasePath({ DATABASE_PATH: path }, args), path);
  assert.equal(resolveDatabasePath({ DATABASE_PATH: ':memory:' }, ['--production']), ':memory:');
});

test('不同数据库中的项目和原型各自保存，开发写入不改变生产内容', () => {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/database-isolation-'));
  const prodPath = resolve(directory, 'forma.db'), devPath = resolve(directory, 'forma.dev.db');
  const prod = openDatabase(prodPath), dev = openDatabase(devPath);
  try {
    const production = createRepository(prod.db), development = createRepository(dev.db);
    production.initialize(); development.initialize();
    production.createPage('default-project', '正式页面');
    development.createPage('default-project', '开发页面');
    const current = development.readDocument('default-page')!;
    current.document.elements.find(e => e.id === 'title')!.text = '仅开发修改';
    development.saveDocument('default-page', current.revision, current.document);
    assert.equal(production.readDocument('default-page')!.document.elements.find(e => e.id === 'title')!.text, '用户管理');
    assert.equal(production.listPages('default-project').some(p => p.name === '开发页面'), false);
    assert.equal(development.listPages('default-project').some(p => p.name === '正式页面'), false);
  } finally { prod.close(); dev.close(); }
  const reopened = openDatabase(prodPath);
  try { assert.equal(createRepository(reopened.db).readDocument('default-page')!.document.elements.find(e => e.id === 'title')!.text, '用户管理'); }
  finally { reopened.close(); }
});
