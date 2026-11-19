// Dedicated child process: load the business project's own Vite and configuration.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

let server;
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  try { await server?.close(); } finally { process.exit(0); }
}
process.on('message', message => { if (message?.type === 'stop') void stop(); });
process.on('disconnect', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
try {
  const options = JSON.parse(process.env.FORMA_PREVIEW_OPTIONS || '{}');
  const inspector = await readFile(new URL('./application-preview-bridge.js', import.meta.url), 'utf8');
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const packagePath = require.resolve('vite/package.json');
  const { createServer } = await import(pathToFileURL(resolve(dirname(packagePath), 'dist/node/index.js')).href);
  server = await createServer({
    root: process.cwd(), base: options.base,
    plugins: [{
      name: 'forma-preview-error-reporting',
      transformIndexHtml() {
        return [{ tag: 'script', attrs: { type: 'module' }, injectTo: 'head-prepend', children: `
const report = message => { if (window.parent !== window) window.parent.postMessage({ type: 'forma:runtime-error', message: String(message).slice(0, 3000) }, window.location.origin); };
window.addEventListener('error', event => { if (event.message) report(event.message); else if (event.target?.tagName === 'SCRIPT') report('页面脚本未能加载，请查看运行日志'); }, true);
window.addEventListener('unhandledrejection', event => report(event.reason?.message || event.reason || '页面运行失败'));
// Standalone previews keep their managed process alive until the tab is closed.
if (window.parent === window) setInterval(() => { void fetch(${JSON.stringify(options.base.replace('/__forma_runtime/', '/api/projects/').replace(/\/$/, '/runtime'))}).catch(() => {}); }, 30000);
${inspector}
` }];
      },
    }],
    server: { host: '127.0.0.1', port: options.port, strictPort: true, open: false, hmr: false },
    clearScreen: false,
  });
  if (closing) await stop();
  await server.listen();
  process.send?.({ type: 'ready' });
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.send?.({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
  await server?.close();
  process.disconnect?.();
}
