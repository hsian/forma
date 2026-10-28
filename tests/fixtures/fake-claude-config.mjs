import assert from 'node:assert/strict';
let input = ''; for await (const chunk of process.stdin) input += chunk;
assert.equal(process.env.ANTHROPIC_BASE_URL, 'https://minimax.example.test/anthropic');
assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, 'test-minimax-token');
assert.equal(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'MiniMax-test');
assert.equal(process.argv[process.argv.indexOf('--model') + 1], 'MiniMax-test');
assert.equal(process.argv[process.argv.indexOf('--setting-sources') + 1], '');
assert.equal(process.env.FORMA_TEST_UNSAFE_SETTING, undefined);
if (input.includes('AUTH')) {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in. Please run login' }) + '\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ type: 'result', structured_output: { reply: '已沿用 MiniMax 连接配置', operations: [] } }) + '\n');
