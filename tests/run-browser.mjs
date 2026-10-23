import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

const scripts = process.argv.slice(2);
const suites = scripts.length ? scripts : ['browser.mjs', 'dialog.browser.mjs', 'select.browser.mjs', 'persistence.browser.mjs', 'projects.browser.mjs'];
await mkdir('test-results', { recursive: true });
for (const suite of suites) {
  if (!/^[a-z.-]+\.mjs$/.test(suite)) throw Error('无效测试脚本名');
  const directory = await mkdtemp(resolve('test-results/browser-db-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = { ...process.env, PORT: String(port), DATABASE_PATH: resolve(directory, 'qa.db'), TEST_URL: `http://127.0.0.1:${port}` };
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw Error(`测试服务退出：${logs}`);
      try { const response = await fetch(`${env.TEST_URL}/api/health`); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw Error(`测试服务未就绪：${logs}`);
    const child = spawn(process.execPath, [resolve('tests', suite)], { env, stdio: 'inherit' });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    if (code !== 0) throw Error(`${suite} 失败，退出码 ${code}`);
    console.log(`PASS ${suite}（独立测试数据库）`);
  } finally {
    if (server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  }
}
