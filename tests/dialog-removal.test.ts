import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDialog } from '../shared/dialogs';
import { makeElement } from '../shared/model';
import { useEditor } from '../src/store';
import { documentSchema } from '../server/document-validation';
import { rowActionDocument } from './fixtures/row-actions';

test('删除弹窗同时清理内容、标注和跨表引用，撤销完整恢复，禁止只读删除', () => {
  const doc = rowActionDocument();
  doc.annotations = [
    { id: 'page-note', number: 1, x: .1, y: .1, title: '', content: '' },
    { id: 'dialog-note', number: 2, x: .1, y: .1, title: '', content: '', dialogId: 'edit-record' },
  ];
  const trigger = { ...makeElement('button'), action: 'modal' as const, modalId: 'edit-record' };
  const toggle = { ...makeElement('button'), action: 'toggle' as const, targetId: 'row-name', visibleWhen: { sourceId: 'row-status', value: 'active' } };
  doc.elements.push(trigger, toggle);
  const table = doc.elements.find(e => e.id === 'records')!.table!;
  table.columnControls = [{ sourceId: 'row-status' }];
  table.filters!.push({ sourceId: 'row-name', fields: ['name'], mode: 'contains', live: false });
  table.columns[0].visibleWhen = { sourceId: 'row-status', value: 'active' };
  const editor = useEditor;
  editor.getState().setReadOnly(false);
  editor.getState().replace(structuredClone(doc));
  editor.getState().commit(d => removeDialog(d, 'edit-record'));
  const removed = editor.getState().doc;
  assert.deepEqual(removed.dialogs?.map(d => d.id), ['delete-record']);
  assert.equal(removed.elements.some(e => e.parentId === 'edit-record'), false);
  assert.deepEqual(removed.annotations?.map(n => n.id), ['page-note']);
  assert.equal(removed.elements.find(e => e.id === trigger.id)!.action, 'none');
  assert.equal(removed.elements.find(e => e.id === toggle.id)!.targetId, undefined);
  assert.equal(removed.elements.find(e => e.id === toggle.id)!.visibleWhen, undefined);
  assert.deepEqual(removed.elements.find(e => e.id === 'records')!.table!.rowActions!.map(a => a.id), ['delete', 'show']);
  assert.deepEqual(removed.elements.find(e => e.id === 'other-records')!.table!.rowActions!.map(a => a.id), ['other-delete']);
  assert.equal(removed.elements.find(e => e.id === 'records')!.table!.filters!.length, 1);
  assert.deepEqual(removed.elements.find(e => e.id === 'records')!.table!.columnControls, []);
  documentSchema.parse(removed);
  editor.getState().undo(); assert.deepEqual(editor.getState().doc, doc);
  editor.getState().redo(); assert.deepEqual(editor.getState().doc, removed);
  editor.getState().undo();
  editor.getState().setReadOnly(true);
  editor.getState().commit(d => removeDialog(d, 'edit-record'));
  assert.deepEqual(editor.getState().doc, doc);
  editor.getState().setReadOnly(false);
});
