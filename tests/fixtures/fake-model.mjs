// 仅供隔离测试通过 FORMA_*_CLI 指定；产品运行时不加载此文件。
import { writeFileSync } from 'node:fs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const context = JSON.parse(input.split('上下文JSON：\n').at(-1).split('\n\n校验修正请求：\n')[0]);
const codex = process.argv.includes('exec');
if (context.message.includes('AUTH')) {
  // Split stderr across writes and keep the process alive, like a CLI retrying authentication.
  process.stderr.write('invalid_refresh_');
  setTimeout(() => process.stderr.write('token: Please try signing in again.'), 50);
  await new Promise(resolve => setTimeout(resolve, 10000));
  process.exit(1);
}
if (context.message.includes('QUOTA') && codex) { process.stderr.write('usage_limit_reached'); process.exit(1); }
if (context.message.includes('429')) { process.stderr.write('429 Too Many Requests'); process.exit(1); }
if (context.message.includes('延迟') || context.message.includes('停止测试')) await new Promise(resolve => setTimeout(resolve, context.message.includes('停止测试') ? 10000 : 1200));
const id = context.selectedIds[0] || 'query';
const result = { reply: '已生成按钮颜色调整，可以在画布中查看。', operations: [{ type: 'updateElement', targetId: id, kind: '', properties: JSON.stringify({ fill: '#1677ff' }) }] };
if (context.message.includes('只讨论')) { result.reply = '可以调整按钮颜色，目前没有修改页面。'; result.operations = []; }
if (context.message.includes('不合法')) result.operations[0].properties = '{"fontSize":10}';
if (context.message.includes('自动修正测试') && !input.includes('校验修正请求：')) result.operations[0].properties = '{"fill":"red"}';
const analysisReply = context.scope === 'design-analysis' ? { reply: `水平间距 ${context.measurement.spacing?.horizontalGap ?? '未选两个图层'}px；填充 ${context.measurement.selected[0]?.fill || '未选图层'}；字号 ${context.measurement.selected[0]?.fontSize ?? '未知'}px。` } : result;
const raw = JSON.stringify(analysisReply);
if (codex) {
  const at = process.argv.indexOf('--output-last-message');
  if (at !== -1) writeFileSync(process.argv[at + 1], raw);
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: raw } }) + '\n');
} else {
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: raw } } }) + '\n');
  process.stdout.write(JSON.stringify({ type: 'result', structured_output: analysisReply }) + '\n');
}
