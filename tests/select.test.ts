import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeElement, getSelectConfig, normalizeSelectConfig } from '../shared/model';
import { useEditor } from '../src/store';

test('Select 实例和复制后的选项配置相互独立，并支持撤销', () => {
  const first = makeElement('select'), second = makeElement('select');
  assert.notEqual(first.select?.options[0].id, second.select?.options[0].id);
  const copy = { ...structuredClone(first), id: crypto.randomUUID() };
  useEditor.getState().replace({ width: 800, height: 600, background: '#ffffff', elements: [first, second, copy] });
  const config = getSelectConfig(copy);
  useEditor.getState().patch(copy.id, { select: { ...config, options: config.options.map((item, index) => index === 0 ? { ...item, label: '副本选项' } : item) } });
  assert.equal(getSelectConfig(useEditor.getState().doc.elements[0]).options[0].label, '选项一');
  assert.equal(getSelectConfig(useEditor.getState().doc.elements[1]).options[0].label, '选项一');
  assert.equal(getSelectConfig(useEditor.getState().doc.elements[2]).options[0].label, '副本选项');
  useEditor.getState().undo();
  assert.equal(getSelectConfig(useEditor.getState().doc.elements[2]).options[0].label, '选项一');
});

test('选项默认值按稳定 ID 保留，删除失效项、切换单选时不会留下无效默认值', () => {
  const original = getSelectConfig(makeElement('select'));
  const [a, b] = original.options;
  const config = { ...original, options: [b, { ...a, label: '已改名' }], multiple: true, defaultValues: [a.id, b.id, a.id, 'missing'] };
  assert.deepEqual(normalizeSelectConfig(config).defaultValues, [a.id, b.id]);
  assert.deepEqual(normalizeSelectConfig({ ...config, options: [b] }).defaultValues, [b.id]);
  assert.deepEqual(normalizeSelectConfig({ ...config, multiple: false }).defaultValues, [a.id]);
  assert.deepEqual(normalizeSelectConfig({ ...config, options: [] }).defaultValues, []);
});
