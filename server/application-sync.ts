import type { FastifyInstance } from 'fastify';
import { ManagementError, type createRepository } from './db/repository.js';
import type { createApplicationWorkspace } from './application-workspace.js';

/** SQLite outbox catches normal saves, AI writes, imports and page tree changes alike. */
export function registerApplicationSync(app: FastifyInstance, repository: ReturnType<typeof createRepository>, workspace: ReturnType<typeof createApplicationWorkspace>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  function syncProject(projectId: string) {
    const snapshot = repository.applicationSnapshot(projectId);
    try {
      const result = workspace.sync(snapshot);
      repository.finishApplicationSync(projectId, snapshot.syncRevision, result.syncedAt, result.sourceFiles, result.warning);
      return { ...result, pageCount: snapshot.pages.length };
    } catch (error) {
      const message = error instanceof ManagementError ? error.message : '工程同步失败，请检查存放目录的权限或占用后重试';
      repository.failApplicationSync(projectId, message);
      throw error instanceof ManagementError ? error : new ManagementError(message, 503);
    }
  }
  function flushPending() {
    if (closed) return;
    for (const state of repository.pendingApplicationSyncs()) {
      if (state.error && state.attemptedAt && Date.now() - state.attemptedAt < 10000) continue;
      try { syncProject(state.projectId); }
      catch { /* Failure is persisted for the UI; page saving remains successful. */ }
    }
  }
  function schedule() {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = undefined; flushPending(); }, 120);
    timer.unref();
  }
  app.addHook('onReady', async () => {
    // Upgrade existing linked projects and repair any interrupted generation on restart.
    for (const project of repository.listProjects()) if (project.application) repository.requestApplicationSync(project.id);
    schedule();
    interval = setInterval(flushPending, 1000);
    interval.unref();
  });
  app.addHook('onResponse', async request => { if (request.url.startsWith('/api/')) schedule(); });
  app.addHook('preClose', async () => { closed = true; clearTimeout(timer); clearInterval(interval); });
  return { syncProject, flushPending };
}
