import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { createRepository } from './db/repository.js';
import type { OfflineVersion } from '../shared/offline-version.js';

export function versionSnapshot(repository: ReturnType<typeof createRepository>, projectId: string, versionId: string): OfflineVersion {
  const frozen = repository.readVersion(projectId, versionId);
  const snapshot: OfflineVersion = {
    format: 'forma-offline-version', formatVersion: 1, exportedAt: Date.now(),
    project: frozen.project, version: { id: frozen.version.id, name: frozen.version.name, description: frozen.version.description, createdAt: frozen.version.createdAt },
    pages: frozen.pages, documents: {}, assets: {},
  };
  for (const page of frozen.pages) {
    const document = repository.readVersionDocument(projectId, versionId, page.id, true).document;
    for (const element of document.elements) {
      const src = element.component?.src;
      if (typeof src !== 'string' || !['image', 'avatar'].includes(element.kind) || !src) continue;
      const hash = createHash('sha256').update(src).digest('hex');
      snapshot.assets[hash] = src;
      element.component!.src = `forma-offline-asset:${hash}`;
    }
    snapshot.documents[page.id] = document;
  }
  return snapshot;
}

let runtime: Promise<{ script: string; css: string }> | undefined;
async function offlineRuntime() {
  runtime ||= (async () => {
    const directory = new URL('../dist/offline/', import.meta.url);
    const read = async () => ({ script: await readFile(new URL('preview.js', directory), 'utf8'), css: await readFile(new URL('preview.css', directory), 'utf8') });
    try { return await read(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Development/older installations may not have built the standalone player yet.
      const { build } = await import('vite');
      await build({ root: fileURLToPath(new URL('../', import.meta.url)), configFile: fileURLToPath(new URL('../vite.offline.config.ts', import.meta.url)), logLevel: 'error' });
      return read();
    }
  })().catch(error => { runtime = undefined; throw error; });
  return runtime;
}

export async function renderVersionHtml(snapshot: OfflineVersion) {
  const { script, css } = await offlineRuntime();
  const data = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const title = `${snapshot.project.name} · ${snapshot.version.name}`.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  const policy = "default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${title}</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script id="forma-offline-data" type="application/json">${data}</script><script src="data:text/javascript;base64,${Buffer.from(script).toString('base64')}"></script></body></html>`;
}

export function versionHtmlFilename(snapshot: OfflineVersion) {
  return (`${snapshot.project.name}-${snapshot.version.name}`).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 160) + '.html';
}
