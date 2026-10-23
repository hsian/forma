import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useEditor } from '../src/store';
import { makeElement } from '../shared/model';

test('编辑操作支持撤销、重做，撤销后编辑会清空重做历史', () => {
  const store = useEditor;
  store.getState().replace({ width: 800, height: 600, background: '#ffffff', elements: [] });
  const e = makeElement('rectangle', 20, 30);
  store.getState().commit(d => { d.elements.push(e); });
  store.getState().patch(e.id, { x: 100, fill: '#000000' });
  store.getState().undo();
  assert.equal(store.getState().doc.elements[0].x, 20);
  assert.equal(store.getState().doc.elements[0].fill, '#eeedff');
  store.getState().redo();
  assert.equal(store.getState().doc.elements[0].x, 100);
  store.getState().undo();
  store.getState().patch(e.id, { y: 80 });
  assert.equal(store.getState().future.length, 0);
  assert.equal(store.getState().doc.elements[0].y, 80);
});

test('一次多元素操作作为一步撤销，且历史文档不受后续编辑污染', () => {
  const a = makeElement('rectangle'), b = makeElement('button');
  useEditor.getState().replace({ width: 800, height: 600, background: '#ffffff', elements: [a, b] });
  useEditor.getState().commit(d => { d.elements.forEach(e => { e.x = 200; }); });
  assert.equal(useEditor.getState().past.length, 1);
  useEditor.getState().undo();
  assert.deepEqual(useEditor.getState().doc.elements.map(e => e.x), [80, 80]);
  useEditor.getState().commit(() => {});
  assert.equal(useEditor.getState().past.length, 0);
});
