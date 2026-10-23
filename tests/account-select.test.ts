import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountSelectDocument } from '../examples/account-select';
import { documentSchema } from '../server/document-validation';
import { initialValues, matches, tableRows, tableColumns } from '../shared/runtime';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';

test('账套原型的页签、组织、条件筛选、列勾选能组合工作，模拟查询不改变原始数据', () => {
  const doc = documentSchema.parse(accountSelectDocument());
  const table = doc.elements.find(e => e.id === 'account-table')!;
  const values = initialValues(doc);
  assert.equal(tableRows(table, values).length, 9);
  values['account-tree'] = 'village-a';
  assert.equal(tableRows(table, values).length, 3);
  values['account-keyword'] = '不存在';
  assert.equal(tableRows(table, values).length, 3, '关键词直到点击查询才应用');
  assert.equal(tableRows(table, values, { ...values }).length, 0);
  values['account-tabs'] = 'disabled'; values['account-tree'] = '';
  assert.equal(tableRows(table, values).length, 7);
  values['account-status'] = 'stopped';
  assert.equal(tableRows(table, values).length, 4);
  assert.equal(matches(table.table!.columns[5].visibleWhen, values), true);
  assert.equal(tableColumns(table, values).length, 6);
  values['account-disabled-fields'] = ['accountBookName'];
  assert.deepEqual(tableColumns(table, values).map(c => c.key), ['accountBookName']);
  assert.equal(table.table!.rows.length, 16);
});

test('原型文档经校验和数据库保存后保留组件配置、关联与模拟数据', () => {
  const database = openDatabase(':memory:');
  try {
    const repo = createRepository(database.db); repo.initialize();
    const existing = repo.bootstrap();
    const page = repo.createPage(existing.project.id, '账套选择');
    const document = documentSchema.parse(accountSelectDocument());
    assert.equal(repo.saveDocument(page.id, 0, document).status, 'saved');
    assert.deepEqual(repo.readDocument(page.id)?.document, document);
    assert.deepEqual(repo.readDocument(existing.page.id), { document: existing.document, revision: existing.revision, updatedAt: existing.updatedAt });
  } finally { database.close(); }
});
