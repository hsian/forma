import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedDocument } from '../shared/model';
import { addAnnotation, surfaceAnnotations } from '../shared/annotations';
import { documentSchema } from '../server/document-validation';
import { useEditor } from '../src/store';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { applyAiResult } from '../server/ai/operations';

test('独立标注层兼容旧文档、按页面和弹窗分开，位置归一化并校验无效数据', () => {
  const doc = structuredClone(seedDocument);
  assert.deepEqual(documentSchema.parse(doc), doc);
  const page = addAnnotation(doc, { x: .2, y: .3 })!;
  const dialog = addAnnotation(doc, { x: -1, y: 4 }, doc.dialogs![0].id)!;
  page.title = '手机号规则'; page.content = '必填，输入后校验格式。';
  assert.deepEqual(surfaceAnnotations(doc).map(note => note.number), [1]);
  assert.deepEqual(surfaceAnnotations(doc, doc.dialogs![0].id).map(note => note.number), [2]);
  assert.deepEqual([dialog.x, dialog.y], [0, 1]);
  assert.deepEqual(documentSchema.parse(doc).annotations, doc.annotations);
  for (const patch of [{ x: 1.1 }, { y: NaN }, { number: 0 }, { content: 'x'.repeat(5001) }, { dialogId: 'absent' }]) {
    const invalid = structuredClone(doc); Object.assign(invalid.annotations![0], patch);
    assert.equal(documentSchema.safeParse(invalid).success, false, JSON.stringify(patch));
  }
  const duplicated = structuredClone(doc); duplicated.annotations!.push({ ...page });
  assert.equal(documentSchema.safeParse(duplicated).success, false);
  const tooMany = structuredClone(doc); tooMany.annotations = Array.from({ length: 501 }, (_, index) => ({ ...page, id: `note-${index}`, number: index + 1 }));
  assert.equal(documentSchema.safeParse(tooMany).success, false);
  assert.equal(addAnnotation(tooMany, { x: .1, y: .2 }), undefined);
});

test('标注编辑与原型元素分离，支持撤销重做，只读时不能新增或修改', () => {
  useEditor.getState().setReadOnly(false);
  useEditor.getState().replace(structuredClone(seedDocument));
  const elements = structuredClone(useEditor.getState().doc.elements);
  useEditor.getState().commit(doc => { addAnnotation(doc, { x: .1, y: .3 }); });
  useEditor.getState().commit(doc => { doc.annotations![0].content = '这里显示错误提示'; });
  useEditor.getState().undo(); assert.equal(useEditor.getState().doc.annotations![0].content, '');
  useEditor.getState().undo(); assert.equal(useEditor.getState().doc.annotations, undefined);
  useEditor.getState().redo(); useEditor.getState().redo();
  assert.equal(useEditor.getState().doc.annotations![0].content, '这里显示错误提示');
  assert.deepEqual(useEditor.getState().doc.elements, elements);
  useEditor.getState().setReadOnly(true);
  useEditor.getState().commit(doc => { doc.annotations = []; });
  assert.equal(useEditor.getState().doc.annotations!.length, 1);
  useEditor.getState().setReadOnly(false);
});

test('标注随文档存储、复制和固定版本保留，后续改动不影响历史版本', () => {
  const connection = openDatabase(':memory:');
  try {
    const repository = createRepository(connection.db); repository.initialize();
    const original = repository.readDocument('default-page')!;
    const doc = structuredClone(original.document);
    addAnnotation(doc, { x: .2, y: .4 })!.content = '固定版的业务规则';
    addAnnotation(doc, { x: .5, y: .6 }, doc.dialogs![0].id)!.content = '弹窗字段规则';
    assert.equal(repository.saveDocument('default-page', original.revision, documentSchema.parse(doc)).status, 'saved');
    const draft = repository.draftVersionManifest('default-project');
    const version = repository.createVersion('default-project', '标注基准', '', '测试', draft.stamp).version;
    const current = repository.readDocument('default-page')!;
    current.document.annotations![0].content = '草稿更新后的规则';
    repository.saveDocument('default-page', current.revision, current.document);
    const history = repository.readVersionDocument('default-project', version.id, 'default-page').document;
    assert.equal(history.annotations![0].content, '固定版的业务规则');
    const copied = repository.copyVersion('default-project', version.id);
    assert.deepEqual(repository.readDocument(copied.page.id)!.document.annotations, history.annotations);
    const duplicated = repository.duplicatePage('default-page');
    assert.equal(repository.readDocument(duplicated.id)!.document.annotations![0].content, '草稿更新后的规则');
  } finally { connection.close(); }
});

test('AI 修改原型元素时保留独立标注，不将标注转换为画布元素', () => {
  const doc = structuredClone(seedDocument);
  addAnnotation(doc, { x: .1, y: .2 })!.content = '保留人工标注';
  const result = applyAiResult(doc, { reply: '已更新标题', operations: [{ type: 'updateElement', targetId: 'title', kind: 'text', properties: JSON.stringify({ text: '新的页面标题' }) }] });
  assert.deepEqual(result.document.annotations, doc.annotations);
  assert.equal(result.document.elements.length, doc.elements.length);
});
