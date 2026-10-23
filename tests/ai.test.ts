import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { applyAiResult } from '../server/ai/operations';
import { generate, parseCliEvent, replyText, webSocketOverrides, friendlyError } from '../server/ai/provider';
import { seedDocument } from '../shared/model';
import { useEditor } from '../src/store';
import type { AiOperation } from '../shared/ai';

const op = (targetId: string, properties: object, type: AiOperation['type'] = 'updateElement'): AiOperation => ({ type, targetId, kind: '', properties: JSON.stringify(properties) });
test('AI 修改按稳定 ID 原子执行，支持整轮撤销，非法字号、锁定元素和悬空引用不应用', () => {
  const source = structuredClone(seedDocument);
  const original = JSON.stringify(source);
  const result = applyAiResult(source, { reply: '改好了', operations: [op('query', { fill: '#1677ff' }), op('title', { text: '新的标题' })] });
  assert.equal(JSON.stringify(source), original);
  assert.equal(result.document.elements.find(e => e.id === 'query')?.fill, '#1677ff');
  useEditor.getState().replace(source);
  useEditor.getState().commit(d => Object.assign(d, result.document));
  useEditor.getState().undo(); assert.deepEqual(useEditor.getState().doc, source);
  for (const operations of [[op('query', { fontSize: 10 })], [op('header-bg', { fill: '#1677ff' })], [op('missing', {})], [op('query', { onClick: 'eval()' })], [op('query', { action: 'modal', modalId: 'missing' })], [op('query', {}, 'removeElement'), op('add', { action: 'toggle', targetId: 'query' })]]) {
    assert.throws(() => applyAiResult(source, { reply: '测试', operations }));
    assert.equal(JSON.stringify(source), original);
  }
});
test('CLI 两种流事件和结构化回复文本可解析，不将修改指令显示为聊天文字', () => {
  assert.deepEqual(parseCliEvent({ type: 'result', structured_output: { reply: '你好', operations: [] } }), { final: '{"reply":"你好","operations":[]}' });
  assert.equal(replyText('{"reply":"修改\\n按钮","operations":['), '修改\n按钮');
  assert.equal(replyText('{"reply":"不完整\\u4'), '');
  assert.deepEqual(webSocketOverrides('[model_providers.local]\nname="Local"\nsupports_websockets=true\n\n[features]\nfoo=true'), ['-c', 'model_providers.local.supports_websockets=false']);
  assert.deepEqual(webSocketOverrides('[model_providers.absent]\nbase_url="https://example.test"'), []);
});
test('独立子进程适配 Codex 和 Claude，只在明确额度耗尽时接续，取消会停止子进程', async () => {
  const keys = ['FORMA_CODEX_CLI', 'FORMA_CLAUDE_CLI', 'FORMA_AI_PROVIDER'];
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.FORMA_CODEX_CLI = process.env.FORMA_CLAUDE_CLI = resolve('tests/fixtures/fake-model.mjs');
    process.env.FORMA_AI_PROVIDER = 'auto';
    const prompt = (message: string) => '上下文JSON：\n' + JSON.stringify({ message, selectedIds: ['query'] });
    const status: string[] = [];
    assert.equal((await generate(prompt('修改'), new AbortController().signal, text => status.push(text), () => {})).provider, 'codex');
    assert.equal((await generate(prompt('QUOTA'), new AbortController().signal, text => status.push(text), () => {})).provider, 'claude');
    assert.ok(status.some(text => text.includes('切换')));
    await assert.rejects(generate(prompt('429'), new AbortController().signal, () => {}, () => {}), /failed/);
    const beforeAuth = Date.now();
    const authStatus: string[] = [];
    await assert.rejects(generate(prompt('AUTH'), new AbortController().signal, text => authStatus.push(text), () => {}), error => {
      assert.match(friendlyError(error), /Codex 登录已失效.*codex login/);
      return true;
    });
    assert.ok(Date.now() - beforeAuth < 5000, '登录失效应立即结束，不等待超时');
    assert.equal(authStatus.length, 1, '登录错误不切换到另一引擎');
    const cancel = new AbortController(); const running = generate(prompt('停止测试'), cancel.signal, () => {}, () => {});
    setTimeout(() => cancel.abort(), 100);
    await assert.rejects(running, /cancelled/);
  } finally { keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
});
