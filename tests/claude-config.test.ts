import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { claudeConfiguration } from '../server/ai/claude-config';
import { generate, friendlyError } from '../server/ai/provider';

function fixture() {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/claude-config-'));
  writeFileSync(join(directory, 'settings.json'), JSON.stringify({
    env: { ANTHROPIC_BASE_URL: 'https://minimax.example.test/anthropic', ANTHROPIC_AUTH_TOKEN: 'test-minimax-token', ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-test', API_TIMEOUT_MS: '300000', FORMA_TEST_UNSAFE_SETTING: 'do-not-inherit' },
    model: 'MiniMax-test', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'do-not-run' }] }] },
  }));
  return directory;
}

test('沿用 Claude 用户连接与模型配置，显式环境优先，不导入其他环境或 hooks', async () => {
  const directory = fixture();
  const result = await claudeConfiguration({ CLAUDE_CONFIG_DIR: directory, ANTHROPIC_BASE_URL: 'https://override.example.test', EXISTING: 'keep' });
  assert.equal(result.env.ANTHROPIC_BASE_URL, 'https://override.example.test');
  assert.equal(result.env.ANTHROPIC_AUTH_TOKEN, 'test-minimax-token');
  assert.equal(result.env.API_TIMEOUT_MS, '300000');
  assert.equal(result.env.EXISTING, 'keep');
  assert.equal(result.env.FORMA_TEST_UNSAFE_SETTING, undefined);
  assert.equal(result.model, 'MiniMax-test');
  assert.equal((await claudeConfiguration({ CLAUDE_CONFIG_DIR: directory, ANTHROPIC_MODEL: 'explicit-model' })).model, undefined);
  writeFileSync(join(directory, 'settings.json'), 'invalid secret-do-not-echo');
  await assert.rejects(claudeConfiguration({ CLAUDE_CONFIG_DIR: directory }), error => {
    assert.match(String(error), /JSON 格式/); assert.doesNotMatch(String(error), /secret-do-not-echo/); return true;
  });
});

test('Claude 子进程实际收到 MiniMax 用户配置，认证错误不再要求第三方服务用户重新登录', async () => {
  const directory = fixture();
  const keys = ['CLAUDE_CONFIG_DIR', 'FORMA_CLAUDE_CLI', 'FORMA_CLAUDE_MODEL', 'FORMA_AI_PROVIDER', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env.CLAUDE_CONFIG_DIR = directory;
    process.env.FORMA_CLAUDE_CLI = resolve('tests/fixtures/fake-claude-config.mjs');
    process.env.FORMA_AI_PROVIDER = 'claude';
    for (const key of ['FORMA_CLAUDE_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL']) delete process.env[key];
    const result = await generate('测试', new AbortController().signal, () => {}, () => {});
    assert.equal(JSON.parse(result.raw).reply, '已沿用 MiniMax 连接配置');
    await assert.rejects(generate('AUTH', new AbortController().signal, () => {}, () => {}), error => {
      assert.match(friendlyError(error), /API 地址和密钥/);
      assert.doesNotMatch(friendlyError(error), /请在终端运行 claude/);
      return true;
    });
  } finally { keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }); }
});
