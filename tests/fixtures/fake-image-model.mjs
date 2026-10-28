// Test-only vision transport fixture. It verifies image bytes actually reach both adapters.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const codex = process.argv.includes('exec');
let bytes;
if (codex) {
  const at = process.argv.indexOf('--image');
  assert.ok(at > 0, 'Codex must receive an image attachment');
  bytes = readFileSync(process.argv[at + 1]);
} else {
  assert.ok(process.argv.includes('--input-format'));
  const message = JSON.parse(input).message;
  assert.equal(message.content[0].type, 'image');
  bytes = Buffer.from(message.content[0].source.data, 'base64');
  input = message.content[1].text;
}
assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
const context = input.includes('上下文JSON：\n') ? JSON.parse(input.split('上下文JSON：\n').at(-1).split('\n\n校验修正请求：\n')[0]) : { message: input };
const message = context.message;
const outputSchema = codex ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--output-schema') + 1], 'utf8')) : JSON.parse(process.argv[process.argv.indexOf('--json-schema') + 1]);
const analyzing = !!outputSchema.properties.summary;
if (message.includes('QUOTA') && codex) { process.stderr.write('usage_limit_reached'); process.exit(1); }
if (message.includes('延迟')) await new Promise(resolve => setTimeout(resolve, 1400));
const add = (targetId, kind, properties) => ({ type: 'addElement', targetId, kind, properties: JSON.stringify(properties) });
let result = { reply: '已重建标题、搜索框、按钮和表格，请校对文字，补充业务交互。', operations: [
  add('image-title', 'text', { name: '迁移页面标题', text: '旧系统用户管理', x: 32, y: 24, width: 400, height: 40, fontSize: 24 }),
  add('image-input', 'input', { name: '用户搜索', text: '请输入姓名', x: 32, y: 90, width: 240, height: 36 }),
  add('image-button', 'button', { name: '查询按钮', text: '查询', x: 290, y: 90, width: 80, height: 36 }),
  add('image-table', 'table', { name: '用户列表', x: 32, y: 150, width: 700, height: 300, table: { columns: [{ key: 'name', title: '姓名' }, { key: 'status', title: '状态' }], rows: [{ name: '张三', status: '正常' }], pageSize: 5 } }),
] };
if (message.includes('修正') && !input.includes('校验修正请求：')) result.operations[0].properties = '{"fontSize":8}';
if (message.includes('始终非法')) result.operations[0].properties = '{"fill":"invalid"}';
if (message.includes('无结果')) result.operations = [];
if (!analyzing && message.includes('需要确认')) assert.equal(context.clarifications[0].answer, '右侧操作列固定', '用户补充必须传入生成阶段');
if (message.includes('滚动测试')) {
  const table = JSON.parse(result.operations[3].properties); table.table.scrollWidth = 1100;
  result.operations[3].properties = JSON.stringify(table);
  if (!input.includes('校验修正请求：')) result.operations.push(add('table_scroll_track', 'rectangle', { name: '表格滚动条轨道', width: 700, height: 8 }));
}
if (analyzing) result = {
  summary: '识别为列表页，底部滚动条属于表格，使用表格原生横向滚动。',
  questions: message.includes('需要确认') && !context.clarifications?.length ? [{ id: 'fixed-column', question: '右侧操作列是否固定，不随表格横向滚动？', options: ['右侧操作列固定', '所有列一起滚动'] }] : [],
};
const raw = JSON.stringify(result);
if (codex) {
  writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], raw);
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: raw } }) + '\n');
} else process.stdout.write(JSON.stringify({ type: 'result', structured_output: result }) + '\n');
