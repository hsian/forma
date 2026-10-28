import { and, asc, eq } from 'drizzle-orm';
import type { AppDatabase } from './index.js';
import { pages, projects, pageDesignSettings, pageDesignBoards } from './schema.js';
import type { PrototypeDocument } from '../../shared/model.js';
import { ManagementError } from './repository.js';

export function createDesignRepository(db: AppDatabase) {
  function designPage(pageId: string) {
    const page = db.select().from(pages).where(eq(pages.id, pageId)).get();
    if (!page) throw new ManagementError('页面不存在', 404);
    return page;
  }
  function listDesignBoards(pageId: string) {
    designPage(pageId);
    return db.select({ id: pageDesignBoards.id, pageId: pageDesignBoards.pageId, name: pageDesignBoards.name, createdAt: pageDesignBoards.createdAt })
      .from(pageDesignBoards).where(eq(pageDesignBoards.pageId, pageId)).orderBy(asc(pageDesignBoards.createdAt)).all();
  }
  function designMetadata(pageId: string) {
    return { uiDesignRequired: db.select().from(pageDesignSettings).where(eq(pageDesignSettings.pageId, pageId)).get()?.required || false,
      uiDesignCount: listDesignBoards(pageId).length };
  }
  function setDesignRequired(pageId: string, required: boolean) {
    return db.transaction(() => {
      const page = designPage(pageId);
      db.insert(pageDesignSettings).values({ pageId, required }).onConflictDoUpdate({ target: pageDesignSettings.pageId, set: { required } }).run();
      const updatedAt = Date.now();
      db.update(pages).set({ updatedAt }).where(eq(pages.id, pageId)).run();
      db.update(projects).set({ updatedAt }).where(eq(projects.id, page.projectId)).run();
      return designMetadata(pageId);
    });
  }
  function attachDesignBoard(projectId: string, pageId: string, name: string, document: PrototypeDocument) {
    return db.transaction(() => {
      const page = designPage(pageId);
      if (page.projectId !== projectId) throw new ManagementError('只能关联当前项目内的页面');
      const board = { id: crypto.randomUUID(), pageId, name, content: document, createdAt: Date.now() };
      db.insert(pageDesignBoards).values(board).run();
      setDesignRequired(pageId, true);
      return { page: { ...page, ...designMetadata(pageId) }, board: { id: board.id, pageId, name, createdAt: board.createdAt } };
    });
  }
  function readDesignBoard(pageId: string, designId: string) {
    designPage(pageId);
    const board = db.select().from(pageDesignBoards).where(and(eq(pageDesignBoards.pageId, pageId), eq(pageDesignBoards.id, designId))).get();
    if (!board) throw new ManagementError('设计稿不存在', 404);
    return { document: board.content };
  }
  function copyDesigns(sourceId: string, targetId: string) {
    const settings = db.select().from(pageDesignSettings).where(eq(pageDesignSettings.pageId, sourceId)).get();
    if (settings) db.insert(pageDesignSettings).values({ ...settings, pageId: targetId }).run();
    for (const board of db.select().from(pageDesignBoards).where(eq(pageDesignBoards.pageId, sourceId)).all())
      db.insert(pageDesignBoards).values({ ...board, id: crypto.randomUUID(), pageId: targetId }).run();
  }
  return { designMetadata, listDesignBoards, setDesignRequired, attachDesignBoard, readDesignBoard, copyDesigns };
}
