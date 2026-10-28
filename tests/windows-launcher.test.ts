import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
// @ts-expect-error Plain JavaScript launcher is also executable before TypeScript dependencies are installed.
import { runLauncher, prepareEnvironment, backupDatabase } from '../scripts/windows-launcher.mjs';

function fixture() {
  mkdirSync('test-results', { recursive: true });
  const root = mkdtempSync(resolve('test-results/windows launcher '));
  mkdirSync(join(root, 'server/db'), { recursive: true });
  copyFileSync('server/db/config.ts', join(root, 'server/db/config.ts'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, '.env.example'), 'PORT=39991\nFORMA_AI_PROVIDER=auto\n');
  return root;
}

test('首次启动配置只创建一次，保留已有 .env 及外部环境设置', () => {
  const root = fixture();
  assert.equal(prepareEnvironment(root, {}).PORT, '39991');
  writeFileSync(join(root, '.env'), 'PORT=39992\nCUSTOM_VALUE=keep\n');
  assert.equal(prepareEnvironment(root, { PORT: '39993' }).PORT, '39993');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'PORT=39992\nCUSTOM_VALUE=keep\n');
});

test('在线备份包含尚在 WAL 中的记录，备份后源库内容不变', async () => {
  const root = fixture(), source = join(root, 'forma.db');
  const database = new Database(source);
  try {
    database.pragma('journal_mode = WAL'); database.pragma('wal_autocheckpoint = 0');
    database.exec("CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES ('保留的生产数据');");
    const target = await backupDatabase(root, source);
    const backup = new Database(target, { readonly: true });
    try { assert.equal((backup.prepare('select value from sample').get() as { value: string }).value, '保留的生产数据'); }
    finally { backup.close(); }
    assert.equal((database.prepare('select count(*) n from sample').get() as { n: number }).n, 1);
    assert.equal(existsSync(join(root, 'backups')), true);
  } finally { database.close(); }
});

test('生产更新在依赖更新和迁移前备份，失败后停止，不覆盖配置或开发数据', async () => {
  const root = fixture(), source = join(root, 'data/forma.db'); mkdirSync(join(root, 'data'));
  const database = new Database(source); database.exec('CREATE TABLE important(value TEXT);'); database.close();
  writeFileSync(join(root, 'data/forma.dev.db'), '开发数据不动');
  const calls: string[] = [];
  await assert.rejects(runLauncher('update', { root, env: {}, dependenciesReady: () => true, checkPort: async () => {}, execute: async (args: string[]) => {
    calls.push(args.join(' '));
    assert.ok(readdirSync(join(root, 'backups')).length > 0, '执行依赖更新前已有备份');
    if (args.join(' ') === 'run db:migrate:production') throw Error('模拟迁移失败');
  } }), /模拟迁移失败/);
  assert.deepEqual(calls, ['ci --include=dev --ignore-scripts', 'rebuild esbuild', 'run build', 'run db:migrate:production']);
  assert.equal(readFileSync(join(root, 'data/forma.dev.db'), 'utf8'), '开发数据不动');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), 'PORT=39991\nFORMA_AI_PROVIDER=auto\n');
});

test('端口冲突时不更新依赖、不备份、不迁移；开发启动只使用开发模式', async () => {
  const root = fixture(); const calls: string[] = [];
  await assert.rejects(runLauncher('start', { root, env: {}, checkPort: async () => { throw Error('端口冲突'); }, execute: async () => { calls.push('unexpected'); } }), /端口冲突/);
  assert.equal(calls.length, 0); assert.equal(existsSync(join(root, 'backups')), false);
  await runLauncher('dev', { root, env: {}, dependenciesReady: () => true, checkPort: async () => {}, execute: async (args: string[], _root: string, env: NodeJS.ProcessEnv) => {
    calls.push(args.join(' ')); assert.equal(env.NODE_ENV, 'development'); assert.equal(env.HOST, '127.0.0.1');
  } });
  assert.deepEqual(calls, ['run dev']);
});

test('Windows 命令入口可从其他目录运行，支持带空格路径，防火墙测试不修改系统', { skip: process.platform !== 'win32' }, () => {
  const root = fixture(); mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/windows-launcher.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('invocation.json',JSON.stringify({mode:process.argv[2],cwd:process.cwd()}));");
  for (const [file, mode] of [['start-lan.cmd', 'start'], ['update-server.cmd', 'update'], ['backup-data.cmd', 'backup'], ['start-dev.cmd', 'dev'], ['allow-lan.cmd', 'firewall']]) {
    const target = join(root, file); copyFileSync(file, target);
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${target}""`], { cwd: resolve('test-results'), input: '\r\n', windowsHide: true, windowsVerbatimArguments: true, stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(result.status, 0, `${result.error || ''}${result.stdout}${result.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'invocation.json'), 'utf8')), { mode, cwd: root });
  }
});

test('全新部署依次安装、构建、迁移并启动，不重复安装依赖', async () => {
  const root = fixture(); const calls: string[] = [];
  await runLauncher('update', { root, env: {}, dependenciesReady: () => false, checkPort: async () => {}, execute: async (args: string[], _root: string, env: NodeJS.ProcessEnv) => {
    calls.push(args.join(' ')); assert.equal(env.NODE_ENV, 'production'); assert.equal(env.HOST, '0.0.0.0');
  } });
  assert.deepEqual(calls, ['ci --include=dev --ignore-scripts', 'rebuild esbuild', 'run build', 'run db:migrate:production', 'start']);
  assert.equal(existsSync(join(root, 'data/forma.dev.db')), false);
});
