import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname, isAbsolute, delimiter } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { aiResultJsonSchema } from '../../shared/ai.js';

export type Provider = 'codex' | 'claude';
type Launch = { command: string; args: string[] };
export function resolveCli(provider: Provider): Launch | null {
  const configured = process.env[`FORMA_${provider.toUpperCase()}_CLI`];
  if (configured && isAbsolute(configured) && existsSync(configured)) {
    if (/\.m?js$/i.test(configured)) return { command: process.execPath, args: [configured] };
    if (!/\.(cmd|ps1|bat)$/i.test(configured)) return { command: configured, args: [] };
  }
  if (configured) return null;
  const directories = [...new Set([...(process.env.PATH || '').split(delimiter), process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '', dirname(process.execPath)].filter(Boolean))];
  for (const directory of directories) {
    const executable = join(directory, provider + (process.platform === 'win32' ? '.exe' : ''));
    if (existsSync(executable)) return { command: executable, args: [] };
    const packageDirectory = join(directory, 'node_modules', provider === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code');
    try {
      const pkg = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[provider];
      const path = join(packageDirectory, bin);
      if (existsSync(path)) return /\.m?js$/i.test(path) ? { command: process.execPath, args: [path] } : { command: path, args: [] };
    } catch { /* Try the next install location. */ }
  }
  return null;
}
export function stopProcess(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => child.kill());
  } else child.kill('SIGTERM');
}
class ModelError extends Error { constructor(public kind: 'quota' | 'failed' | 'timeout' | 'missing' | 'cancelled' | 'authentication', public provider?: Provider) { super(kind); } }
const authenticationFailed = (text: string) => /invalid_refresh_token|refresh_token_reused|refresh_token_expired|access token could not be refreshed|authentication token[^\n]*try signing in again|not logged in[^\n]*login/i.test(text);
const quota = (text: string) => /usage_limit_reached|insufficient_quota|quota_exceeded|you(?:'ve| have) (?:hit|reached) your usage limit|credits? (?:exhausted|depleted)|额度(?:已)?(?:耗尽|用完|不足)/i.test(text);
export function parseCliEvent(record: Record<string, any>) {
  if (record.type === 'item.completed' && record.item?.type === 'error') return { error: String(record.item.message || '') };
  if (record.type === 'result' && record.structured_output) return { final: JSON.stringify(record.structured_output) };
  if (record.type === 'result' && record.is_error) return { error: JSON.stringify(record.errors || record.result) };
  if (record.type === 'result' && typeof record.result === 'string') return { final: record.result };
  if (record.type === 'turn.failed' || record.type === 'error') return { error: JSON.stringify(record.error || record.message || record) };
  if (record.type === 'item.completed' && record.item?.type === 'agent_message') return { final: String(record.item.text || '') };
  if (record.type === 'stream_event' && record.event?.delta?.type === 'text_delta') return { delta: String(record.event.delta.text || '') };
  return {};
}
export function replyText(raw: string) {
  const match = /"reply"\s*:\s*"/.exec(raw); if (!match) return '';
  const rest = raw.slice(match.index + match[0].length); let escaped = false; let index = 0;
  for (; index < rest.length; index++) { if (!escaped && rest[index] === '"') break; if (!escaped && rest[index] === '\\') escaped = true; else escaped = false; }
  const value = rest.slice(0, index);
  try { return JSON.parse('"' + value + '"') as string; } catch { return ''; }
}
export function webSocketOverrides(config: string) {
  return [...config.matchAll(/^\s*\[model_providers\.["']?([a-zA-Z0-9_-]+)["']?\]([^]*?)(?=^\s*\[|$(?![^]))/gm)]
    .filter(match => /^\s*name\s*=\s*["']/m.test(match[2])).flatMap(match => ['-c', `model_providers.${match[1]}.supports_websockets=false`]);
}
async function invoke(provider: Provider, prompt: string, signal: AbortSignal, onText: (text: string) => void) {
  const launch = resolveCli(provider); if (!launch) throw new ModelError('missing');
  const directory = await mkdtemp(join(tmpdir(), 'forma-ai-'));
  try {
    const schemaPath = join(directory, 'schema.json'); const outputPath = join(directory, 'result.json');
    await writeFile(schemaPath, JSON.stringify(aiResultJsonSchema), 'utf8');
    const args = provider === 'codex' ? ['exec', '--json', '--color', 'never', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'mcp_servers={}', '--output-schema', schemaPath, '--output-last-message', outputPath,
      ...['shell_tool', 'unified_exec', 'code_mode', 'apps', 'browser_use', 'computer_use'].flatMap(feature => ['--disable', feature]), '-'] :
      ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', '--permission-mode', 'dontAsk', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--json-schema', JSON.stringify(aiResultJsonSchema)];
    if (provider === 'codex') {
      const transport: string[] = [];
      if (process.env.FORMA_CODEX_SYSTEM_PROXY !== 'false') transport.push('--enable', 'respect_system_proxy');
      if (process.env.FORMA_CODEX_DISABLE_WEBSOCKETS !== 'false') {
        const config = await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8').catch(() => '');
        transport.push(...webSocketOverrides(config));
      }
      args.splice(args.length - 1, 0, ...transport);
    }
    const model = process.env[`FORMA_${provider.toUpperCase()}_MODEL`];
    if (model) args.splice(provider === 'codex' ? args.length - 1 : args.length, 0, '--model', model);
    const result = await new Promise<string>((resolve, reject) => {
      if (signal.aborted) { reject(new ModelError('cancelled')); return; }
      const child = spawn(launch.command, [...launch.args, ...args], { cwd: directory, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let buffer = ''; let output = ''; let final = ''; let error = ''; let bytes = 0; let settled = false; let published = '';
      const finish = (cause?: Error) => {
        if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
        stopProcess(child); cause ? reject(cause) : resolve(final);
      };
      const cancel = () => finish(new ModelError('cancelled'));
      const timer = setTimeout(() => finish(new ModelError('timeout')), Math.min(300000, Math.max(1000, Number(process.env.FORMA_AI_TIMEOUT_MS) || 120000)));
      signal.addEventListener('abort', cancel, { once: true });
      function line(text: string) {
        try {
          const parsed = parseCliEvent(JSON.parse(text));
          if (process.env.FORMA_AI_DIAGNOSTICS === 'true') { const event = JSON.parse(text); console.error('[Forma AI event]', provider, String(event.type || 'unknown'), String(event.item?.type || '')); }
          if (parsed.error) {
            error = parsed.error;
            if (authenticationFailed(error)) { finish(new ModelError('authentication', provider)); return; }
            if (JSON.parse(text).type === 'turn.failed') { finish(new ModelError(quota(error) ? 'quota' : 'failed', provider)); return; }
          }
          if (parsed.delta) output += parsed.delta;
          if (parsed.final) { final = parsed.final; output = parsed.final; }
          const reply = replyText(output);
          if (reply.startsWith(published) && reply.length > published.length) { onText(reply.slice(published.length)); published = reply; }
          if (parsed.final) { try { const value = JSON.parse(parsed.final); if (value.reply && Array.isArray(value.operations)) finish(); } catch { /* Wait for complete output. */ } }
        } catch { /* Ignore CLI diagnostics on stdout. */ }
      }
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (settled) return; bytes += Buffer.byteLength(chunk);
        if (bytes > 8 * 1024 * 1024) { finish(new ModelError('failed')); return; }
        buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop() || ''; lines.forEach(line);
      });
      child.stderr.on('data', (chunk: string) => {
        if (settled) return;
        error = (error + chunk).slice(-6000);
        if (authenticationFailed(error)) finish(new ModelError('authentication', provider));
      });
      child.on('error', () => finish(new ModelError('failed')));
      child.stdin.on('error', () => {});
      child.on('close', code => { if (settled) return; if (buffer.trim()) line(buffer); if (settled) return; if (quota(error)) finish(new ModelError('quota')); else if (code !== 0 || !final) finish(new ModelError('failed')); else finish(); });
      child.stdin.end(prompt);
    });
    const file = provider === 'codex' ? await readFile(outputPath, 'utf8').catch(() => '') : '';
    return file.trim() || result;
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {}); }
}
export async function generate(prompt: string, signal: AbortSignal, onStatus: (text: string) => void, onText: (text: string) => void) {
  const requested = process.env.FORMA_AI_PROVIDER || 'auto';
  const first: Provider = requested === 'claude' ? 'claude' : 'codex';
  try { onStatus(`正在由 ${first === 'codex' ? 'Codex' : 'Claude'} 处理`); return { raw: await invoke(first, prompt, signal, onText), provider: first }; }
  catch (error) {
    if (requested === 'auto' && first === 'codex' && error instanceof ModelError && error.kind === 'quota' && !signal.aborted) {
      onStatus('Codex 额度已用完，正在切换到 Claude');
      return { raw: await invoke('claude', prompt, signal, onText), provider: 'claude' as const };
    }
    throw error;
  }
}
export function friendlyError(error: unknown) {
  if (error instanceof ModelError && error.kind === 'authentication') return error.provider === 'claude'
    ? 'Claude 登录已失效，请在终端运行 claude 完成登录后重新发送。本轮未修改原型。'
    : 'Codex 登录已失效，请在终端运行 codex login 重新登录后发送。本轮未修改原型。';
  if (error instanceof ModelError) return { authentication: '模型登录已失效，请重新登录后发送。', missing: '未找到模型命令，请在本机安装并登录 Codex 或 Claude，或配置本项目的命令路径。', timeout: '模型响应超时，可以重试。', cancelled: '已停止，本轮没有修改原型。', quota: '模型额度不足，请稍后重试或调整引擎配置。', failed: '模型调用失败，请检查本机模型命令的登录和网络配置。' }[error.kind];
  return error instanceof Error ? error.message : '处理失败，请重试';
}
