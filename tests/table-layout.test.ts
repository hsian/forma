import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableLayout, prepareImageTables } from '../shared/table-layout';
import { imageTableDocument } from './fixtures/image-table';
import { documentSchema } from '../server/document-validation';
import { applyAiResult } from '../server/ai/operations';

test('165px 紧凑表格自动容纳四行，隐藏未声明且不需要的分页，不修改源数据', () => {
  const doc = imageTableDocument(); const original = structuredClone(doc);
  const table = doc.elements.find(e => e.table)!;
  const layout = tableLayout(table);
  assert.equal(layout.pagination, false);
  assert.ok(layout.appearance.headerHeight + layout.appearance.rowHeight * 4 + 2 <= table.height);
  const prepared = prepareImageTables(doc);
  assert.equal(prepared.elements.find(e => e.table)!.table!.pagination, false);
  assert.deepEqual(doc, original);
  table.height = 400;
  assert.equal(tableLayout(table).custom, false, '原有足够高的普通表格保留默认样式');
  assert.equal(tableLayout(table).pagination, true);
  table.table!.scrollWidth = 2100;
  assert.equal(tableLayout(table).custom, true, '普通高表格也应应用显式滚动内容宽度');
  assert.equal(tableLayout(table).columnsWidth, 2100);
});

test('表头、行高、背景、对齐及分页通过文档和 AI 校验；局部改行高保留其他外观', () => {
  const doc = imageTableDocument(true); documentSchema.parse(doc);
  const next = applyAiResult(doc, { reply: '调小行高', operations: [{ type: 'updateElement', targetId: 'image-bank-table', kind: '', properties: JSON.stringify({ table: { appearance: { rowHeight: 30 } } }) }] }).document;
  assert.equal(next.elements[2].table!.appearance!.rowHeight, 30);
  assert.equal(next.elements[2].table!.appearance!.headerBackground, '#e3efff');
  assert.equal(next.elements[2].table!.pagination, false);
  const invalid = structuredClone(doc); invalid.elements[2].table!.appearance!.rowHeight = -1;
  assert.equal(documentSchema.safeParse(invalid).success, false);
});

test('旧紧凑表格的蓝色填充用于表头，数据行保持白色，显式单元格背景不被覆盖', () => {
  const doc = imageTableDocument(); const table = doc.elements[2];
  table.fill = '#e5effc'; table.stroke = '#d9d9d9';
  const appearance = tableLayout(table).appearance;
  assert.equal(appearance.headerBackground, '#e5effc');
  assert.equal(appearance.bodyBackground, '#ffffff');
  assert.equal(appearance.borderColor, '#d9d9d9');
  const prepared = prepareImageTables(doc).elements[2].table!.appearance!;
  assert.equal(prepared.headerBackground, '#e5effc');
  assert.equal(prepared.bodyBackground, '#ffffff');
  table.table!.appearance = { headerBackground: '#111111', bodyBackground: '#ffeeee' };
  assert.equal(tableLayout(table).appearance.bodyBackground, '#ffeeee');
  assert.equal(tableLayout(table).appearance.headerBackground, '#111111');
});
