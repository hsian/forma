import { copyFileSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const modes = ['start', 'update', 'backup', 'dev', 'firewall'];

export function prepareEnvironment(root, inherited = process.env) {
  const path = join(root, '.env');
  if (!existsSync(path) && existsSync(join(root, '.env.example'))) {
    try { copyFileSync(join(root, '.env.example'), path, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return { ...(existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}), ...inherited };
}

export function assertPortFree(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error(`端口 ${port} 正在使用或不可用。请先在原服务窗口按 Ctrl+C 停止服务，再重新运行。`)));
    probe.listen({ port, host, exclusive: true }, () => probe.close(error => error ? reject(error) : resolve()));
  });
}

export async function backupDatabase(root, databasePath) {
  if (databasePath === ':memory:') throw Error('正式服务不能使用内存数据库，请检查 DATABASE_PATH。');
  if (!existsSync(databasePath)) return null;
  const directory = join(root, 'backups', new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8));
  mkdirSync(directory, { recursive: true });
  const target = join(directory, basename(databasePath));
  // A separate process releases the native SQLite DLL before npm ci replaces dependencies.
  await runProcess(process.execPath, [join(projectRoot, 'scripts/backup-sqlite.mjs'), databasePath, target], root, process.env);
  await writeFile(join(directory, 'backup-info.json'), JSON.stringify({ databasePath, createdAt: new Date().toISOString() }, null, 2));
  return target;
}

function dependenciesReady(root) {
  if (!existsSync(join(root, 'node_modules'))) return false;
  try {
    const require = createRequire(join(root, 'package.json'));
    require.resolve('tsx/esm/api'); require.resolve('typescript'); require.resolve('vite');
    verifySqlite(root);
    return true;
  } catch { return false; }
}

function verifySqlite(root) {
  execFileSync(process.execPath, ['-e', "const Database=require('better-sqlite3');const db=new Database(':memory:');if(db.prepare('select 1 as ok').get().ok!==1)throw Error('SQLite check failed');db.close()"], { cwd: root, stdio: 'pipe', windowsHide: true });
}

async function installDependencies(execute, root, env) {
  // better-sqlite3 13 ships N-API prebuilds. npm ci can lose gypfile:false
  // from lockfile metadata and invoke node-gyp unnecessarily on Windows.
  // Run only the build-tool installer needed by this project's locked dependencies.
  await execute(['ci', '--include=dev', '--ignore-scripts'], root, env);
  await execute(['rebuild', 'esbuild'], root, env);
  try { verifySqlite(root); }
  catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw Error(`依赖已下载，但 SQLite 加载验证失败（Node ${process.version} / ${process.platform}-${process.arch}）：\n${detail}`);
  }
}

function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')].filter(Boolean);
  if (process.platform === 'win32') {
    try {
      for (const path of execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)) candidates.push(join(dirname(path), 'node_modules/npm/bin/npm-cli.js'));
    } catch { /* Report one useful installation message below. */ }
  }
  const found = candidates.find(path => path.endsWith('.js') && existsSync(path));
  if (!found) throw Error('未找到 npm。请安装 Node.js 22 或以上版本，安装时保留 npm，然后重新运行。');
  return found;
}

function runProcess(command, args, root, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, shell: false, stdio: 'inherit', windowsHide: true });
    let interrupted = false;
    // Windows broadcasts Ctrl+C to the console's children as well. Wait for their cleanup.
    const interrupt = () => { interrupted = true; if (process.platform !== 'win32') child.kill('SIGINT'); };
    process.on('SIGINT', interrupt);
    const cleanup = () => process.removeListener('SIGINT', interrupt);
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => {
      cleanup();
      if (interrupted) { const error = Error('已停止。'); error.interrupted = true; reject(error); }
      else if (code === 0) resolve();
      else reject(Error(`命令执行失败（退出码 ${code}），后续操作已停止。请查看上面的错误信息。`));
    });
  });
}

function runNpm(args, root, env) { return runProcess(process.execPath, [npmCli(), ...args], root, env); }

function addresses(port) {
  const ips = new Set(Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4').map(item => item.address));
  console.log(`本机访问：http://127.0.0.1:${port}`);
  for (const ip of ips) console.log(`局域网访问：http://${ip}:${port}`);
}

async function firewall(root, env, port) {
  if (process.platform !== 'win32') throw Error('防火墙入口仅用于 Windows。');
  const program = process.execPath.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop';
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '请右键 allow-lan.cmd，选择以管理员身份运行。' }
$name='Forma-LAN-${port}';
if (Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -Name $name }
New-NetFirewallRule -Name $name -DisplayName 'Forma LAN (${port})' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet -Profile Private,Domain -Program '${program}' | Out-Null;
Write-Host '已允许同一子网访问 Forma。服务器网络连接应设为专用网络或域网络。'`;
  await runProcess('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], root, env);
}

export async function runLauncher(mode, options = {}) {
  if (!modes.includes(mode)) throw Error('请使用项目目录中的 .cmd 文件启动。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('请先安装 Node.js 22 或以上版本。');
  const root = options.root || projectRoot;
  const execute = options.execute || runNpm;
  const checkPort = options.checkPort || assertPortFree;
  const ready = options.dependenciesReady || dependenciesReady;
  const env = prepareEnvironment(root, options.env || process.env);
  const port = Number(env.PORT || 6060);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('.env 中的 PORT 必须是 1 到 65535 之间的整数。');
  if (mode === 'firewall') { await firewall(root, env, port); return; }
  const production = mode !== 'dev';
  env.NODE_ENV = production ? 'production' : 'development';
  env.HOST = production ? '0.0.0.0' : '127.0.0.1';
  if (mode !== 'backup') await checkPort(port, env.HOST);
  let installed = false;
  if (mode !== 'backup' && !ready(root)) {
    console.log('首次运行：正在安装依赖，需要联网…');
    await installDependencies(execute, root, env);
    installed = true;
  }
  // Use the server's configuration rules in a short-lived process, avoiding locked build tools on Windows.
  let databasePath;
  try {
    databasePath = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {resolveDatabasePath} from './server/db/config.ts';process.stdout.write(resolveDatabasePath(process.env,JSON.parse(process.argv[1])))", JSON.stringify([production ? '--production' : '--development'])], { cwd: root, env, encoding: 'utf8', windowsHide: true }).trim();
  } catch { throw Error('无法读取数据库配置。请检查 Node.js 和项目依赖是否安装完整。'); }
  if (production && databasePath === ':memory:') throw Error('正式服务不能使用内存数据库，请检查 DATABASE_PATH。');
  console.log(`当前环境：${production ? '生产' : '开发'}\n数据库：${databasePath}`);
  if (production) {
    const backup = await backupDatabase(root, databasePath);
    console.log(backup ? `数据备份完成：${backup}` : '尚无生产数据库，启动时会创建新库。');
  }
  if (mode === 'backup') return;
  if (mode === 'update' && !installed) {
    console.log('正在更新依赖…');
    await installDependencies(execute, root, env);
  }
  if (production && (mode === 'update' || !existsSync(join(root, 'dist/index.html')))) await execute(['run', 'build'], root, env);
  if (production) await execute(['run', 'db:migrate:production'], root, env);
  console.log('\n正在启动。请保持本窗口打开；停止服务请按 Ctrl+C。');
  if (production) addresses(port); else console.log(`开发访问：http://127.0.0.1:${port}`);
  await execute(production ? ['start'] : ['run', 'dev'], root, env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLauncher(process.argv[2]).catch(error => { if (error.interrupted) return; console.error(`\n操作未完成：${error.message}`); process.exitCode = 1; });
}
