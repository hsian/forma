import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApplicationRuntimeStatus } from '../shared/application-runtime.js';
import { ManagementError, type createRepository } from './db/repository.js';
import type { registerApplicationSync } from './application-sync.js';
import type { AuthService } from './auth.js';

interface Runtime {
  projectId: string; state: ApplicationRuntimeStatus['state']; instanceId: string; port: number;
  directory: string; error: string | null; logs: string; child?: ChildProcess;
  ready?: Promise<void>; stopping?: Promise<void>; touchedAt: number;
}
const launcher = fileURLToPath(new URL('../scripts/application-preview.mjs', import.meta.url));
const cleanLog = (value: string) => value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

export function registerApplicationRuntime(app: FastifyInstance, repository: ReturnType<typeof createRepository>, sync: ReturnType<typeof registerApplicationSync>, auth?: AuthService) {
  const runtimes = new Map<string, Runtime>();
  let closed = false;
  const base = (projectId: string) => `/__forma_runtime/${encodeURIComponent(projectId)}/`;
  function status(projectId: string): ApplicationRuntimeStatus {
    const project = repository.readProject(projectId);
    const runtime = runtimes.get(projectId);
    if (runtime) runtime.touchedAt = Date.now();
    const generated = repository.applicationSyncStatus(projectId);
    return {
      state: runtime?.state || 'stopped', available: !!project.application,
      instanceId: runtime?.instanceId || null,
      url: runtime?.state === 'running' ? base(projectId) : null,
      error: runtime?.error || null, logs: runtime?.logs || '',
      directory: project.application?.directory || null,
      publishedRevision: generated?.publishedRevision || 0,
      syncError: generated?.error || null,
    };
  }
  async function stopRuntime(runtime: Runtime) {
    if (runtime.stopping) return runtime.stopping;
    runtime.state = 'stopped';
    runtime.stopping = (async () => {
      const child = runtime.child;
      if (!child || child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>(resolve => {
        let finished = false;
        const done = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null && child.pid) {
            // Only the process launched and owned by this runtime can be terminated.
            if (process.platform === 'win32') {
              const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
              killer.once('error', () => { child.kill(); done(); }); killer.once('exit', done);
            } else { child.kill('SIGKILL'); }
          } else done();
        }, 3000);
        child.once('exit', done);
        if (child.connected) child.send({ type: 'stop' }, error => { if (error) child.kill(); });
        else child.kill();
      });
    })();
    return runtime.stopping;
  }
  async function start(projectId: string) {
    if (closed) throw new ManagementError('服务正在关闭，请稍后重试', 503);
    let existing = runtimes.get(projectId);
    if (existing?.stopping) { await existing.stopping; existing = undefined; }
    if (existing?.state === 'running') return status(projectId);
    if (existing?.state === 'starting' && existing.ready) { await existing.ready; return status(projectId); }
    if (existing?.state === 'error') await stopRuntime(existing);
    if ([...runtimes.values()].filter(runtime => runtime.state === 'running' || runtime.state === 'starting').length >= 3) throw new ManagementError('已有 3 个项目在运行预览，请先停止一个项目', 409);
    const project = repository.readProject(projectId);
    if (!project.application) throw new ManagementError('当前是纯原型项目，尚未关联可运行的业务工程', 409);
    const runtime: Runtime = { projectId, state: 'starting', instanceId: randomUUID(), directory: project.application.directory, port: 0, error: null, logs: '', touchedAt: Date.now() };
    runtimes.set(projectId, runtime);
    runtime.ready = (async () => {
      try {
        sync.syncProject(projectId);
        const require = createRequire(resolve(runtime.directory, 'package.json'));
        for (const dependency of ['vite/package.json', 'react', 'react-dom', 'antd', '@ant-design/icons', 'dayjs']) {
          try { require.resolve(dependency); } catch { throw new ManagementError('业务工程缺少依赖，请先在工程目录执行 npm install，再点击重试', 409); }
        }
        if (!existsSync(resolve(runtime.directory, 'index.html'))) throw new ManagementError('业务工程缺少 index.html，请检查工程目录', 409);
        runtime.port = await freePort();
        if (runtime.state === 'stopped' || closed) return;
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, [launcher], {
            cwd: runtime.directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: { ...process.env, FORCE_COLOR: '0', FORMA_PREVIEW_OPTIONS: JSON.stringify({ port: runtime.port, base: base(projectId) }) },
          });
          runtime.child = child;
          let settled = false;
          const finish = (error?: Error) => { if (!settled) { settled = true; clearTimeout(timeout); error ? reject(error) : resolve(); } };
          const timeout = setTimeout(() => { finish(new ManagementError('开发预览启动超时，请查看运行日志后重试', 503)); void stopRuntime(runtime); }, 30000);
          const log = (chunk: Buffer) => { runtime.logs = (runtime.logs + cleanLog(chunk.toString())).slice(-16000); };
          child.stdout?.on('data', log); child.stderr?.on('data', log);
          child.once('error', error => finish(new ManagementError(`无法启动开发预览：${error.message}`, 503)));
          child.on('message', message => {
            const value = message as { type?: string; message?: string };
            if (value.type === 'ready') { if (runtime.state !== 'stopped' && !closed) runtime.state = 'running'; finish(); }
            if (value.type === 'failed') finish(new ManagementError(`业务工程启动失败：${value.message || '请查看运行日志'}`, 503));
          });
          child.once('exit', code => {
            if (runtime.state !== 'stopped') { runtime.state = 'error'; runtime.error ||= `开发预览已退出（${code ?? '进程终止'}），请查看日志后重试`; }
            finish(new ManagementError(runtime.error || '开发预览已停止', 503));
          });
        });
      } catch (error) {
        if (runtime.state !== 'stopped') runtime.state = 'error';
        runtime.error = error instanceof Error ? error.message : '开发预览启动失败';
        throw error;
      }
    })();
    await runtime.ready;
    return status(projectId);
  }
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof ManagementError) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(503).send({ message: error instanceof Error ? error.message : '开发预览暂不可用' });
  }
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/runtime', async (request, reply) => { try { return status(request.params.projectId); } catch (error) { return failure(error, reply); } });
  for (const action of ['start', 'stop'] as const) app.post<{ Params: { projectId: string } }>(`/api/projects/:projectId/runtime/${action}`, async (request, reply) => {
    if (auth && !auth.can(request.identity!.user, request.params.projectId, 'project.update')) return reply.code(403).send({ message: '请项目维护者启动或停止开发预览' });
    try {
      if (action === 'start') return await start(request.params.projectId);
      const runtime = runtimes.get(request.params.projectId);
      if (runtime) await stopRuntime(runtime);
      return status(request.params.projectId);
    } catch (error) { return failure(error, reply); }
  });
  app.get<{ Params: { projectId: string; '*': string } }>('/__forma_runtime/:projectId/*', async (request, reply) => {
    const runtime = runtimes.get(request.params.projectId);
    if (!runtime || runtime.state !== 'running') return reply.code(503).send({ message: '开发预览未运行，请返回编辑器启动预览' });
    runtime.touchedAt = Date.now();
    return proxyFrame(request, reply, runtime);
  });
  async function proxyFrame(request: FastifyRequest, reply: FastifyReply, runtime: Runtime) {
    return new Promise<void>(resolve => {
      const headers = { ...request.headers, host: `127.0.0.1:${runtime.port}`, 'accept-encoding': 'identity' };
      delete headers.cookie; delete headers.authorization;
      const upstream = httpRequest({ host: '127.0.0.1', port: runtime.port, path: request.raw.url, method: request.method, headers }, response => {
        reply.code(response.statusCode || 502);
        for (const [name, value] of Object.entries(response.headers)) if (value !== undefined && !['set-cookie', 'connection', 'keep-alive', 'transfer-encoding', 'content-length', 'access-control-allow-origin'].includes(name)) reply.header(name, value);
        reply.header('Cache-Control', 'no-store');
        reply.send(response); resolve();
      });
      upstream.setTimeout(30000, () => upstream.destroy(Error('预览请求超时')));
      upstream.once('error', error => { if (!reply.sent) reply.code(502).send({ message: `开发预览连接失败：${error.message}` }); resolve(); });
      request.raw.once('aborted', () => upstream.destroy());
      upstream.end();
    });
  }
  const idle = setInterval(() => {
    for (const runtime of runtimes.values()) {
      let removed = false;
      try { removed = !repository.readProject(runtime.projectId).application; } catch { removed = true; }
      if (removed || Date.now() - runtime.touchedAt > 5 * 60000) void stopRuntime(runtime);
    }
  }, 15000);
  idle.unref();
  app.addHook('preClose', async () => { closed = true; clearInterval(idle); await Promise.all([...runtimes.values()].map(stopRuntime)); });
  return { status, start };
}
