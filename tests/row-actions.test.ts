import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowActionDocument } from './fixtures/row-actions';
import { initialValues, rowActions, rowDraft, rowText, tableRows, updateMockRow } from '../shared/runtime';
import { applyAiResult } from '../server/ai/operations';
import { documentSchema } from '../server/document-validation';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';

test('筛选后保持源行定位、弹窗回填和模拟更新不改变原型，纯文本模板不执行表达式', () => {
  const doc = rowActionDocument(); const table = doc.elements.find(e => e.id === 'records')!;
  const original = structuredClone(doc); const values = initialValues(doc); values['row-search'] = 'Delta';
  const row = tableRows(table, values)[0]; const rowIndex = table.table!.rows.indexOf(row);
  assert.equal(rowIndex, 3);
  const context = { tableId: table.id, rowIndex, row };
  const draft = rowDraft(doc, 'edit-record', values, row);
  assert.equal(draft['row-name'], 'Delta'); assert.equal(draft['row-status'], 'active');
  assert.equal(rowText('名称：{{row.name}} / {{row.missing}}', row), '名称：Delta / ');
  assert.equal(rowText('{{row.name.toUpperCase()}}', row), '');
  assert.equal(rowText('{{row.name}}'), '{{row.name}}');
  const updated = updateMockRow(table.table!.rows, context, doc.elements, 'edit-record', { ...draft, 'row-name': '修改后', 'row-status': 'archived' });
  assert.equal(updated[3].name, '修改后'); assert.equal(updated[3].status, 'archived'); assert.equal(updated[3].secret, 'Delta-hidden');
  assert.deepEqual(updated.slice(0, 3), table.table!.rows.slice(0, 3));
  assert.equal(updateMockRow(updated, context, doc.elements, 'delete-record', {}, true).length, 3);
  assert.deepEqual(doc, original);
  assert.equal(rowActions({ columns: [], rows: [], pageSize: 5, rowActionText: '旧按钮' })[0].label, '旧按钮');
  assert.deepEqual(rowActions({ columns: [], rows: [], pageSize: 5, rowActionText: '旧按钮', rowActions: [] }), []);
});

test('行操作和字段绑定经过保存重开及 AI 操作保留，拒绝不存在的弹窗和重复操作 ID', () => {
  const doc = rowActionDocument(); documentSchema.parse(doc);
  const opened = openDatabase(':memory:');
  try {
    const repository = createRepository(opened.db); repository.initialize(); const original = repository.readDocument('default-page')!;
    repository.saveDocument('default-page', original.revision, doc);
    assert.deepEqual(repository.readDocument('default-page')!.document, doc);
  } finally { opened.sqlite.close(); }
  const result = applyAiResult(doc, { reply: '添加行操作', operations: [{ type: 'updateElement', targetId: 'records', kind: '', properties: JSON.stringify({ table: { ...doc.elements.find(e => e.id === 'records')!.table, rowActions: [{ id: 'review', label: '审核', action: 'modal', modalId: 'edit-record' }] } }) }] });
  assert.equal(result.document.elements.find(e => e.id === 'records')!.table!.rowActions![0].label, '审核');
  const broken = structuredClone(doc); broken.elements.find(e => e.id === 'records')!.table!.rowActions![0].modalId = 'absent';
  assert.equal(documentSchema.safeParse(broken).success, false);
  const duplicate = structuredClone(doc); const actions = duplicate.elements.find(e => e.id === 'records')!.table!.rowActions!; actions.push({ ...actions[0] });
  assert.equal(documentSchema.safeParse(duplicate).success, false);
});
