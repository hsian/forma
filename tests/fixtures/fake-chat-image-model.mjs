// Isolated tests only: require actual image bytes on both CLI transports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
let input = ''; for await (const chunk of process.stdin) input += chunk;
const codex = process.argv.includes('exec');
let bytes;
if (codex) {
  const index = process.argv.indexOf('--image'); assert.ok(index >= 0, 'missing image argument');
  bytes = readFileSync(process.argv[index + 1]);
} else {
  assert.ok(process.argv.includes('--input-format'));
  const packet = JSON.parse(input); const image = packet.message.content.find(item => item.type === 'image');
  assert.equal(image.source.media_type, 'image/png');
  bytes = Buffer.from(image.source.data, 'base64');
  input = packet.message.content.find(item => item.type === 'text').text;
}
assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
const context = JSON.parse(input.split('上下文JSON：\n').at(-1).split('\n\n校验修正请求：\n')[0]);
assert.equal(context.referenceImage.width, bytes.readUInt32BE(16));
if (context.message.includes('QUOTA') && codex) { process.stderr.write('usage_limit_reached'); process.exit(1); }
if (context.message.includes('FAIL')) { process.stderr.write('test failure'); process.exit(1); }
if (context.message.includes('STOP')) await new Promise(resolve => setTimeout(resolve, 10000));
const result = { reply: '已读取参考图片，可以结合当前页面讨论。', ...(context.scope === 'design-analysis' ? {} : { operations: [] }) };
if (context.message.includes('修正验证')) result.operations = [{ type: 'updateElement', targetId: 'query', kind: '', properties: JSON.stringify({ fill: input.includes('校验修正请求：') ? '#1677ff' : 'red' }) }];
const raw = JSON.stringify(result);
if (codex) {
  writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], raw);
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: raw } }) + '\n');
} else process.stdout.write(JSON.stringify({ type: 'result', structured_output: result }) + '\n');
