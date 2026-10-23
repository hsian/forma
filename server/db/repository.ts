import { and, asc, eq } from 'drizzle-orm';
import { seedDocument, type PrototypeDocument } from '../../shared/model.js';
import { projects, pages, documents } from './schema.js';
import type { AppDatabase } from './index.js';

export const defaultProjectId = 'default-project';
export const defaultPageId = 'default-page';
export class ManagementError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export function createRepository(db: AppDatabase) {
  function initialize() {
    db.transaction(tx => {
      if (tx.select().from(projects).limit(1).get()) return;
      const now = Date.now();
      tx.insert(projects).values({ id: defaultProjectId, name: '单页原型探索', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
      tx.insert(pages).values({ id: defaultPageId, projectId: defaultProjectId, name: '用户管理', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
      tx.insert(documents).values({ pageId: defaultPageId, content: structuredClone(seedDocument), revision: 0, updatedAt: now }).onConflictDoNothing().run();
    });
  }
  function readDocument(pageId: string) {
    const row = db.select().from(documents).where(eq(documents.pageId, pageId)).get();
    return row ? { document: row.content, revision: row.revision, updatedAt: row.updatedAt } : null;
  }
  function bootstrap(requestedPageId?: string) {
    const page = (requestedPageId ? db.select().from(pages).where(eq(pages.id, requestedPageId)).get() : null)
      || db.select().from(pages).orderBy(asc(pages.createdAt), asc(pages.position)).limit(1).get();
    if (!page) throw Error('项目中没有可打开的页面');
    const document = readDocument(page.id);
    const project = db.select().from(projects).where(eq(projects.id, page.projectId)).get();
    if (!document || !project) throw Error('项目文档不存在');
    return { ...document, page, project, capabilities: { persistence: true, filesystem: false } };
  }
  const listProjects = () => db.select().from(projects).orderBy(asc(projects.createdAt)).all();
  const listPages = (projectId: string) => db.select().from(pages).where(eq(pages.projectId, projectId)).orderBy(asc(pages.position), asc(pages.createdAt)).all();
  function descendants(id: string, items: ReturnType<typeof listPages>) {
    const ids = new Set([id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const page of items) if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) { ids.add(page.id); changed = true; }
    }
    return ids;
  }
  function deleteOrder(items: ReturnType<typeof listPages>) {
    const remaining = new Map(items.map(page => [page.id, page]));
    const ordered: string[] = [];
    while (remaining.size) {
      const parents = new Set([...remaining.values()].map(page => page.parentId));
      const leaves = [...remaining.keys()].filter(id => !parents.has(id));
      if (!leaves.length) throw new ManagementError('页面层级异常，无法删除', 409);
      leaves.forEach(id => { ordered.push(id); remaining.delete(id); });
    }
    return ordered;
  }
  function createProject(name: string) {
    return db.transaction(tx => {
      const now = Date.now();
      const project = tx.insert(projects).values({ id: crypto.randomUUID(), name, createdAt: now, updatedAt: now }).returning().get()!;
      const page = tx.insert(pages).values({ id: crypto.randomUUID(), projectId: project.id, name: '首页', createdAt: now, updatedAt: now }).returning().get()!;
      tx.insert(documents).values({ pageId: page.id, content: { width: 1040, height: 720, background: '#f7f8fb', elements: [], dialogs: [] }, updatedAt: now }).run();
      return { project, page };
    });
  }
  function renameProject(id: string, name: string) {
    const project = db.update(projects).set({ name, updatedAt: Date.now() }).where(eq(projects.id, id)).returning().get();
    if (!project) throw new ManagementError('项目不存在', 404);
    return project;
  }
  function deleteProject(id: string) {
    return db.transaction(tx => {
      const items = tx.select().from(projects).orderBy(asc(projects.createdAt)).all();
      if (!items.some(project => project.id === id)) throw new ManagementError('项目不存在', 404);
      if (items.length === 1) throw new ManagementError('至少需要保留一个项目', 409);
      for (const pageId of deleteOrder(listPages(id))) tx.delete(pages).where(eq(pages.id, pageId)).run();
      tx.delete(projects).where(eq(projects.id, id)).run();
      const fallbackPage = tx.select().from(pages).orderBy(asc(pages.createdAt)).limit(1).get()!;
      return { fallbackPageId: fallbackPage.id };
    });
  }
  function createPage(projectId: string, name: string, parentId: string | null = null) {
    return db.transaction(tx => {
      if (!tx.select().from(projects).where(eq(projects.id, projectId)).get()) throw new ManagementError('项目不存在', 404);
      if (parentId) {
        const parent = tx.select().from(pages).where(eq(pages.id, parentId)).get();
        if (!parent || parent.projectId !== projectId) throw new ManagementError('父页面不属于当前项目');
      }
      const siblings = listPages(projectId).filter(page => page.parentId === parentId);
      const now = Date.now();
      const page = tx.insert(pages).values({ id: crypto.randomUUID(), projectId, name, parentId, position: Math.max(-1, ...siblings.map(page => page.position)) + 1, createdAt: now, updatedAt: now }).returning().get()!;
      tx.insert(documents).values({ pageId: page.id, content: { width: 1040, height: 720, background: '#f7f8fb', elements: [], dialogs: [] }, updatedAt: now }).run();
      tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
      return page;
    });
  }
  function updatePage(id: string, changes: { name?: string; parentId?: string | null; order?: 'up' | 'down' }) {
    return db.transaction(tx => {
      const page = tx.select().from(pages).where(eq(pages.id, id)).get();
      if (!page) throw new ManagementError('页面不存在', 404);
      const items = listPages(page.projectId);
      const patch: Partial<typeof pages.$inferInsert> = { updatedAt: Date.now() };
      if (changes.name !== undefined) patch.name = changes.name;
      if (changes.parentId !== undefined) {
        const parent = changes.parentId ? items.find(item => item.id === changes.parentId) : null;
        if (changes.parentId && !parent) throw new ManagementError('父页面不属于当前项目');
        if (changes.parentId && descendants(id, items).has(changes.parentId)) throw new ManagementError('不能把页面移动到自身或其子页面下');
        patch.parentId = changes.parentId;
        patch.position = Math.max(-1, ...items.filter(item => item.parentId === changes.parentId && item.id !== id).map(item => item.position)) + 1;
      }
      if (changes.order) {
        const siblings = items.filter(item => item.parentId === page.parentId);
        // Normalize positions so legacy equal-position rows also move predictably.
        const index = siblings.findIndex(item => item.id === id);
        const other = index + (changes.order === 'up' ? -1 : 1);
        if (other >= 0 && other < siblings.length) [siblings[index], siblings[other]] = [siblings[other], siblings[index]];
        siblings.forEach((item, position) => tx.update(pages).set({ position }).where(eq(pages.id, item.id)).run());
      }
      const updated = tx.update(pages).set(patch).where(eq(pages.id, id)).returning().get()!;
      tx.update(projects).set({ updatedAt: patch.updatedAt }).where(eq(projects.id, page.projectId)).run();
      return updated;
    });
  }
  function duplicatePage(id: string) {
    return db.transaction(tx => {
      const original = tx.select().from(pages).where(eq(pages.id, id)).get();
      const document = readDocument(id);
      if (!original || !document) throw new ManagementError('页面不存在', 404);
      const copy = createPage(original.projectId, `${original.name.slice(0, 117)} 副本`, original.parentId);
      tx.update(documents).set({ content: structuredClone(document.document) }).where(eq(documents.pageId, copy.id)).run();
      return copy;
    });
  }
  function deletePage(id: string) {
    return db.transaction(tx => {
      const page = tx.select().from(pages).where(eq(pages.id, id)).get();
      if (!page) throw new ManagementError('页面不存在', 404);
      const items = listPages(page.projectId);
      const ids = descendants(id, items);
      if (ids.size === items.length) throw new ManagementError('每个项目至少需要保留一个页面，请先新建其他页面', 409);
      for (const pageId of deleteOrder(items.filter(item => ids.has(item.id)))) tx.delete(pages).where(eq(pages.id, pageId)).run();
      tx.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, page.projectId)).run();
      return { deletedIds: [...ids], fallbackPageId: items.find(item => !ids.has(item.id))!.id };
    });
  }
  function saveDocument(pageId: string, revision: number, document: PrototypeDocument) {
    return db.transaction(tx => {
      const current = tx.select().from(documents).where(eq(documents.pageId, pageId)).get();
      if (!current) return { status: 'missing' as const };
      if (current.revision !== revision) return { status: 'conflict' as const, revision: current.revision };
      const updatedAt = Date.now();
      const saved = tx.update(documents).set({ content: document, revision: revision + 1, updatedAt })
        .where(and(eq(documents.pageId, pageId), eq(documents.revision, revision))).returning().get();
      if (!saved) return { status: 'conflict' as const, revision: current.revision };
      const page = tx.update(pages).set({ updatedAt }).where(eq(pages.id, pageId)).returning().get();
      if (page) tx.update(projects).set({ updatedAt }).where(eq(projects.id, page.projectId)).run();
      return { status: 'saved' as const, revision: saved.revision, updatedAt };
    });
  }
  return {
    initialize, bootstrap, readDocument, saveDocument, listProjects, listPages,
    createProject, renameProject, deleteProject, createPage, updatePage, duplicatePage, deletePage,
  };
}
