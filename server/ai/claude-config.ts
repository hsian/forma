import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Carry over connection settings without loading user hooks, plugins or tools.
export async function claudeConfiguration(inherited: NodeJS.ProcessEnv = process.env) {
  const path = join(inherited.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
  let settings: { env?: Record<string, unknown>; model?: unknown } = {};
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid settings');
    settings = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('无法读取 AI 服务配置，请联系管理员检查文件权限和 JSON 格式。');
  }
  const env = { ...inherited };
  for (const [key, value] of Object.entries(settings.env || {})) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_)/.test(key) || /^(API_TIMEOUT_MS|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key)) {
      if (typeof value === 'string' && env[key] === undefined) env[key] = value;
    }
  }
  const model = !env.ANTHROPIC_MODEL && typeof settings.model === 'string' && settings.model.trim() ? settings.model : undefined;
  return { env, model };
}
