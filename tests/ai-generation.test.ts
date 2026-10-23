import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowActionDocument } from './fixtures/row-actions';
import { aiPropertySchemas, applyAiResult } from '../server/ai/operations';
import { generateValidated, validationDetails } from '../server/ai/validated-generation';
import type { generate } from '../server/ai/provider';

const operation = (properties: object) => ({ type: 'updateElement' as const, targetId: 'records', kind: '', properties: JSON.stringify(properties) });
test('AI 仅修改行操作时保留全部表格配置，确认弹窗可以在同一批原子创建', () => {
  const doc = rowActionDocument(); const source = structuredClone(doc);
  const result = applyAiResult(doc, { reply: '增加前置确认', operations: [
    operation({ table: { rowActions: [{ id: 'enter', label: '进入', action: 'modal', modalId: 'enter-confirm' }] } }),
    { type: 'upsertDialog', targetId: 'enter-confirm', kind: '', properties: JSON.stringify({ title: '确认进入', height: 180 }) },
    { type: 'addElement', targetId: 'enter-question', kind: 'text', properties: JSON.stringify({ parentId: 'enter-confirm', text: '是否进入 {{row.name}}？', fontSize: 14 }) },
    { type: 'addElement', targetId: 'enter-cancel', kind: 'button', properties: JSON.stringify({ parentId: 'enter-confirm', text: '取消', action: 'closeModal' }) },
    { type: 'addElement', targetId: 'enter-yes', kind: 'button', properties: JSON.stringify({ parentId: 'enter-confirm', text: '确认', action: 'submit', actionText: '已进入 {{row.name}}' }) },
  ] });
  const originalTable = doc.elements.find(e => e.id === 'records')!.table!;
  const nextTable = result.document.elements.find(e => e.id === 'records')!.table!;
  for (const key of ['rows', 'columns', 'pageSize', 'filters'] as const) assert.deepEqual(nextTable[key], originalTable[key]);
  assert.equal(nextTable.rowActions![0].modalId, 'enter-confirm');
  assert.equal(result.document.elements.find(e => e.id === 'enter-yes')!.action, 'submit');
  assert.deepEqual(doc, source);
  assert.match(JSON.stringify(aiPropertySchemas), /rowActions/);
});

test('属性校验失败只自动修正一次，提供准确字段路径，始终以原始文档校验', async () => {
  const doc = rowActionDocument(); const original = structuredClone(doc); let calls = 0;
  const statuses: string[] = []; const issues: unknown[] = [];
  const invoke: typeof generate = async prompt => {
    calls++;
    if (calls === 2) { assert.match(prompt, /operations\.0\.properties\.table\.rowActions\.0\.action/); assert.match(prompt, /校验修正请求/); }
    return { provider: 'codex', raw: JSON.stringify({ reply: '修改行操作', operations: [operation({ table: { rowActions: [{ id: 'a', label: '查看', action: calls === 1 ? 'confirm' : 'modal', modalId: 'edit-record' }] } })] }) };
  };
  const result = await generateValidated(doc, '原始请求', new AbortController().signal, text => statuses.push(text), () => {}, details => issues.push(details), invoke);
  assert.equal(calls, 2); assert.equal(issues.length, 1); assert.match(statuses.join(''), /自动修正/);
  assert.equal(result.result.document.elements.find(e => e.id === 'records')!.table!.rowActions![0].action, 'modal');
  assert.deepEqual(doc, original);
});

test('修正仍非法、修正遗漏操作、网络失败或停止时不应用文档，也不无限重试', async () => {
  const doc = rowActionDocument(); const original = structuredClone(doc);
  let calls = 0;
  const invalid: typeof generate = async () => { calls++; return { provider: 'codex', raw: JSON.stringify({ reply: '测试', operations: [operation({ madeUp: true })] }) }; };
  await assert.rejects(generateValidated(doc, '请求', new AbortController().signal, () => {}, () => {}, () => {}, invalid), /不支持的属性.*madeUp/);
  assert.equal(calls, 2);
  calls = 0;
  const empty: typeof generate = async (...args) => calls === 0 ? invalid(...args) : { provider: 'codex', raw: '{"reply":"好了","operations":[]}' };
  await assert.rejects(generateValidated(doc, '请求', new AbortController().signal, () => {}, () => {}, () => {}, empty), /遗漏/);
  calls = 0;
  const network: typeof generate = async () => { calls++; throw Error('network failed'); };
  await assert.rejects(generateValidated(doc, '请求', new AbortController().signal, () => {}, () => {}, () => {}, network), /network failed/);
  assert.equal(calls, 1);
  calls = 0; const controller = new AbortController();
  await assert.rejects(generateValidated(doc, '请求', controller.signal, () => {}, () => {}, () => controller.abort(), invalid), /abort/i);
  assert.equal(calls, 1); assert.deepEqual(doc, original);
  assert.equal(validationDetails(new SyntaxError())[0].message, '返回内容必须是有效 JSON');
});
