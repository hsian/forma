import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { antdCatalog, antdKinds, componentIssues, getComponentDefinition } from '../shared/antd-catalog';
import { elementKinds, makeElement, type PrototypeDocument } from '../shared/model';
import { documentSchema } from '../server/document-validation';
import { applyAiResult } from '../server/ai/operations';
import { initialValues } from '../shared/runtime';

test('组件目录覆盖已安装 antd 的全部可视入口，默认配置可以通过文档校验和 JSON 往返', () => {
  const exports = [...readFileSync('node_modules/antd/es/index.d.ts', 'utf8').matchAll(/export \{ default as (\w+) \}/g)].map(match => match[1]);
  const infrastructure = new Set(['App', 'ConfigProvider', 'theme', 'version']);
  const provided = new Set(antdKinds.map(kind => antdCatalog[kind].component.split('.')[0]));
  // Grid uses the actual Row/Col pair; App and ConfigProvider wrap the editor/player.
  for (const name of exports) if (!infrastructure.has(name)) assert.ok(provided.has(['Row', 'Col'].includes(name) ? 'Grid' : name), `${name} 必须有组件适配器`);
  const document: PrototypeDocument = { width: 1600, height: 12000, background: '#ffffff', elements: elementKinds.map(kind => makeElement(kind)) };
  assert.deepEqual(documentSchema.parse(JSON.parse(JSON.stringify(document))), document);
  for (const kind of antdKinds) assert.deepEqual(componentIssues(kind, makeElement(kind).component || {}), [], kind);
  const first = makeElement('radio'), second = makeElement('radio');
  assert.notEqual(first.component, second.component);
  (first.component!.items as { label: string }[])[0].label = '实例一';
  assert.equal((second.component!.items as { label: string }[])[0].label, '选项一');
});

test('AI 支持新增组件和局部更新专属属性；无效属性、值和循环条目整轮拒绝', () => {
  const card = makeElement('card');
  const source: PrototypeDocument = { width: 1000, height: 800, background: '#ffffff', elements: [card] };
  const operation = (properties: object) => ({ type: 'updateElement' as const, kind: '', targetId: card.id, properties: JSON.stringify(properties) });
  const result = applyAiResult(source, { reply: '修改卡片', operations: [operation({ component: { title: '订单信息' } }), { type: 'addElement', targetId: 'date', kind: 'datePicker', properties: JSON.stringify({ component: { showTime: true } }) }] });
  assert.equal(result.document.elements[0].component!.title, '订单信息');
  assert.equal(result.document.elements[0].component!.content, card.component!.content);
  assert.equal(result.document.elements[1].component!.showTime, true);
  for (const properties of [{ component: { onClick: 'alert(1)' } }, { component: { loading: 'yes' } }, { component: { unknown: 2 } }]) assert.throws(() => applyAiResult(source, { reply: '测试', operations: [operation(properties)] }));
  const invalid = makeElement('cascader'); invalid.component!.items = [{ id: 'a', label: 'A', parentId: 'b' }, { id: 'b', label: 'B', parentId: 'a' }];
  assert.equal(documentSchema.safeParse({ ...source, elements: [invalid] }).success, false);
  assert.equal(source.elements[0].component!.title, getComponentDefinition('card')!.defaults.title);
});

test('新增录入组件使用可序列化的模拟值，保留数字零、日期范围、布尔和多选', () => {
  const kinds = ['inputNumber', 'rangePicker', 'switch', 'checkboxSingle', 'transfer', 'treeSelect'] as const;
  const elements = kinds.map(kind => ({ ...makeElement(kind), id: kind }));
  elements.find(e => e.kind === 'rangePicker')!.component = { start: '2026-10-01', end: '2026-10-31' };
  elements.find(e => e.kind === 'treeSelect')!.component = { multiple: true };
  assert.deepEqual(initialValues({ width: 1000, height: 800, background: '#ffffff', elements }), { inputNumber: '0', rangePicker: ['2026-10-01', '2026-10-31'], switch: 'true', checkboxSingle: 'false', transfer: [], treeSelect: [] });
});
