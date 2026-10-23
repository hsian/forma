import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { documents, pages, projects, pageBlobs, projectVersions, versionPages, versionAssets, versionAssetBlobs, aiMessages } from './schema.js';
import { canonicalDocument } from '../../shared/ai.js';
import type { PrototypeDocument } from '../../shared/model.js';
export class VersionError extends Error { constructor(message: string, public statusCode = 400) { super(message); } }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function createVersionRepository(db: AppDatabase) {
  function project(projectId: string) { const value = db.select().from(projects).where(eq(projects.id, projectId)).get(); if (!value) throw new VersionError('项目不存在', 404); return value; }
  function version(projectId: string, versionId: string) { const value = db.select().from(projectVersions).where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId))).get(); if (!value) throw new VersionError('版本不存在或已删除', 404); return value; }
  function manifest(projectId: string) {
    const info = project(projectId);
    const entries = db.select({ page: pages, document: documents.content, revision: documents.revision }).from(pages).innerJoin(documents, eq(pages.id, documents.pageId)).where(eq(pages.projectId, projectId)).all().sort((a, b) => a.page.id.localeCompare(b.page.id));
    return { info, entries, stamp: digest(canonicalDocument({ name: info.name, entries })) };
  }
  const listVersions = (projectId: string) => db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId)).orderBy(desc(projectVersions.createdAt), desc(projectVersions.id)).all();
  function createVersion(projectId: string, name: string, description: string, createdBy: string, stamp: string, guard?: () => void) {
    return db.transaction(tx => {
      guard?.();
      if (tx.select({ id: aiMessages.id }).from(aiMessages).innerJoin(pages, eq(aiMessages.pageId, pages.id)).where(and(eq(pages.projectId, projectId), eq(aiMessages.status, 'running'))).limit(1).get()) throw new VersionError('项目中有 AI 正在生成，请等待生成结束并保存后再确认版本', 423);
      const draft = manifest(projectId);
      if (draft.stamp !== stamp) throw new VersionError('项目已更新，请刷新版本窗口、核对最新内容后重新确认', 409);
      if (listVersions(projectId).some(item => item.name === name)) throw new VersionError('版本名称已存在，请使用新名称', 409);
      if (!draft.entries.length) throw new VersionError('空项目不能创建版本');
      const id = randomUUID(), createdAt = Date.now(); let newPages = 0, newBytes = 0, newAssets = 0;
      tx.insert(projectVersions).values({ id, projectId, projectName: draft.info.name, name, description, createdBy, createdAt }).run();
      for (const { page, document } of draft.entries) {
        const content = structuredClone(document);
        for (const element of content.elements) {
          if (!['image', 'avatar'].includes(element.kind) || !element.component?.src) continue;
          const src = String(element.component.src);
          const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml))(;[^,]*)?,([\s\S]*)$/i.exec(src);
          if (!match) throw new VersionError(`“${page.name}”使用了外部或临时图片，请改为内嵌图片后创建固定版本，避免历史图片随外部地址变化`);
          const bytes = /;base64/i.test(match[2] || '') ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
          const mime = match[1].toLowerCase(), hash = digest(Buffer.concat([Buffer.from(mime + '\0'), bytes]));
          if (!tx.select().from(versionAssetBlobs).where(eq(versionAssetBlobs.hash, hash)).get()) { tx.insert(versionAssetBlobs).values({ hash, mime, data: bytes.toString('base64'), bytes: bytes.length }).run(); newAssets++; newBytes += bytes.length; }
          tx.insert(versionAssets).values({ versionId: id, hash }).onConflictDoNothing().run();
          element.component!.src = `forma-asset:${hash}`;
        }
        const json = canonicalDocument(content), hash = digest(json);
        if (!tx.select().from(pageBlobs).where(eq(pageBlobs.hash, hash)).get()) { const bytes = Buffer.byteLength(json); tx.insert(pageBlobs).values({ hash, content: JSON.parse(json), bytes }).run(); newPages++; newBytes += bytes; }
        tx.insert(versionPages).values({ versionId: id, pageId: page.id, name: page.name, parentId: page.parentId, position: page.position, contentHash: hash }).run();
      }
      return { version: version(projectId, id), totalPages: draft.entries.length, newPages, reusedPages: draft.entries.length - newPages, newAssets, newBytes };
    });
  }
  function readVersion(projectId: string, versionId: string) {
    const item = version(projectId, versionId);
    return { version: item, project: { id: projectId, name: item.projectName, createdAt: item.createdAt, updatedAt: item.createdAt }, pages: db.select().from(versionPages).where(eq(versionPages.versionId, versionId)).all().sort((a, b) => a.position - b.position || a.pageId.localeCompare(b.pageId)).map(page => ({ id: page.pageId, projectId, folderId: null, name: page.name, parentId: page.parentId, position: page.position, createdAt: item.createdAt, updatedAt: item.createdAt })) };
  }
  function readVersionDocument(projectId: string, versionId: string, snapshotPageId: string, inline = false) {
    version(projectId, versionId);
    const page = db.select().from(versionPages).where(and(eq(versionPages.versionId, versionId), eq(versionPages.pageId, snapshotPageId))).get();
    if (!page) throw new VersionError('版本中没有此页面', 404);
    const document = structuredClone(db.select().from(pageBlobs).where(eq(pageBlobs.hash, page.contentHash)).get()!.content);
    for (const element of document.elements) if (typeof element.component?.src === 'string' && element.component.src.startsWith('forma-asset:')) {
      const hash = element.component.src.slice(12);
      if (inline) { const asset = readVersionAsset(projectId, versionId, hash); element.component.src = `data:${asset.mime};base64,${asset.data}`; }
      else element.component.src = `/api/projects/${projectId}/versions/${versionId}/assets/${hash}`;
    }
    return { document, revision: 0, contentHash: page.contentHash };
  }
  function readVersionAsset(projectId: string, versionId: string, hash: string) {
    version(projectId, versionId);
    if (!db.select().from(versionAssets).where(and(eq(versionAssets.versionId, versionId), eq(versionAssets.hash, hash))).get()) throw new VersionError('版本资源不存在', 404);
    return db.select().from(versionAssetBlobs).where(eq(versionAssetBlobs.hash, hash)).get()!;
  }
  function collectVersionBlobs() {
    db.delete(pageBlobs).where(sql`not exists (select 1 from ${versionPages} where ${versionPages.contentHash} = ${pageBlobs.hash})`).run();
    db.delete(versionAssetBlobs).where(sql`not exists (select 1 from ${versionAssets} where ${versionAssets.hash} = ${versionAssetBlobs.hash})`).run();
  }
  function deleteVersion(projectId: string, versionId: string) { return db.transaction(tx => { version(projectId, versionId); tx.delete(projectVersions).where(eq(projectVersions.id, versionId)).run(); collectVersionBlobs(); return { ok: true }; }); }
  function copyVersion(projectId: string, versionId: string) {
    return db.transaction(tx => {
      const snapshot = readVersion(projectId, versionId), id = randomUUID(), now = Date.now();
      const project = tx.insert(projects).values({ id, name: `${snapshot.project.name} · ${snapshot.version.name} 草稿`.slice(0, 120), createdAt: now, updatedAt: now }).returning().get()!;
      const ids = new Map(snapshot.pages.map(page => [page.id, randomUUID()]));
      // Parent rows must exist before children because SQLite checks foreign keys immediately.
      const pending = [...snapshot.pages]; let first: typeof pages.$inferSelect | undefined;
      while (pending.length) {
        const index = pending.findIndex(page => !page.parentId || !pending.some(other => other.id === page.parentId));
        if (index < 0) throw new VersionError('版本页面树异常');
        const [page] = pending.splice(index, 1), newId = ids.get(page.id)!;
        const created = tx.insert(pages).values({ id: newId, projectId: id, name: page.name, parentId: page.parentId ? ids.get(page.parentId)! : null, position: page.position, createdAt: now, updatedAt: now }).returning().get()!;
        first ||= created;
        tx.insert(documents).values({ pageId: newId, content: readVersionDocument(projectId, versionId, page.id, true).document, revision: 0, updatedAt: now }).run();
      }
      return { project, page: first! };
    });
  }
  return { draftVersionManifest: (projectId: string) => db.transaction(() => { const draft = manifest(projectId); return { stamp: draft.stamp, pages: draft.entries.length }; }), listVersions, createVersion, readVersion, readVersionDocument, readVersionAsset, deleteVersion, copyVersion, collectVersionBlobs };
}
