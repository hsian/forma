import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../db/index.js';
import { aiConversations, aiMessages, pages } from '../db/schema.js';

export function registerConversations(app: FastifyInstance, db: AppDatabase, active: Map<string, AbortController>) {
  const current = (pageId: string) => db.select().from(aiConversations).where(and(eq(aiConversations.pageId, pageId), eq(aiConversations.archived, false))).get();
  const create = (pageId: string) => {
    const row = { id: crypto.randomUUID(), pageId, title: '新对话', archived: false, createdAt: Date.now() };
    db.insert(aiConversations).values(row).run(); return row;
  };
  const history = (pageId: string) => {
    const conversation = current(pageId);
    return conversation ? db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversation.id)).orderBy(desc(aiMessages.createdAt)).limit(80).all().reverse() : [];
  };
  type Params = { pageId: string; conversationId: string };
  app.get<{ Params: Params }>('/api/pages/:pageId/ai/conversations', async (request, reply) => {
    const query = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: '分页参数不正确' });
    const rows = db.select().from(aiConversations).where(and(eq(aiConversations.pageId, request.params.pageId), eq(aiConversations.archived, true))).orderBy(desc(aiConversations.createdAt), desc(aiConversations.id)).limit(21).offset((query.data.page - 1) * 20).all();
    return { conversations: rows.slice(0, 20), more: rows.length > 20 };
  });
  app.get<{ Params: Params }>('/api/pages/:pageId/ai/conversations/:conversationId/messages', async (request, reply) => {
    const row = db.select().from(aiConversations).where(and(eq(aiConversations.pageId, request.params.pageId), eq(aiConversations.id, request.params.conversationId))).get();
    if (!row) return reply.code(404).send({ message: '对话不存在' });
    const query = z.object({ beforeId: z.string().min(1).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: '分页参数不正确' });
    const cursor = query.data.beforeId ? db.select().from(aiMessages).where(and(eq(aiMessages.id, query.data.beforeId), eq(aiMessages.conversationId, row.id))).get() : undefined;
    if (query.data.beforeId && !cursor) return reply.code(400).send({ message: '消息分页位置已失效，请重新打开对话' });
    const rows = db.select().from(aiMessages).where(and(eq(aiMessages.conversationId, row.id), cursor ? or(lt(aiMessages.createdAt, cursor.createdAt), and(eq(aiMessages.createdAt, cursor.createdAt), lt(aiMessages.id, cursor.id))) : undefined)).orderBy(desc(aiMessages.createdAt), desc(aiMessages.id)).limit(41).all();
    return { messages: rows.slice(0, 40).reverse(), more: rows.length > 40 };
  });
  app.post<{ Params: Params }>('/api/pages/:pageId/ai/conversations', async (request, reply) => {
    const pageId = request.params.pageId;
    if (!db.select().from(pages).where(eq(pages.id, pageId)).get()) return reply.code(404).send({ message: '页面不存在' });
    if (active.has(pageId)) return reply.code(409).send({ message: '请等当前生成结束后再新建对话' });
    return db.transaction(() => {
      const old = current(pageId);
      if (old && !history(pageId).length) return { conversation: old };
      if (old) db.update(aiConversations).set({ archived: true }).where(eq(aiConversations.id, old.id)).run();
      return { conversation: create(pageId) };
    });
  });
  app.post<{ Params: Params }>('/api/pages/:pageId/ai/conversations/:conversationId/restore', async (request, reply) => {
    const { pageId, conversationId } = request.params;
    if (active.has(pageId)) return reply.code(409).send({ message: '请等当前生成结束后再恢复对话' });
    const row = db.select().from(aiConversations).where(and(eq(aiConversations.id, conversationId), eq(aiConversations.pageId, pageId))).get();
    if (!row) return reply.code(404).send({ message: '对话不存在' });
    db.transaction(() => {
      const old = current(pageId);
      if (old?.id !== row.id && old) {
        if (history(pageId).length) db.update(aiConversations).set({ archived: true }).where(eq(aiConversations.id, old.id)).run();
        else db.delete(aiConversations).where(eq(aiConversations.id, old.id)).run();
      }
      db.update(aiConversations).set({ archived: false }).where(eq(aiConversations.id, row.id)).run();
    });
    return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/pages/:pageId/ai/conversations/:conversationId', async (request, reply) => {
    if (active.has(request.params.pageId)) return reply.code(409).send({ message: '请等当前生成结束后再删除对话' });
    const where = and(eq(aiConversations.id, request.params.conversationId), eq(aiConversations.pageId, request.params.pageId));
    if (!db.delete(aiConversations).where(where).run().changes) return reply.code(404).send({ message: '对话不存在' });
    return { ok: true };
  });
  app.delete<{ Params: Params }>('/api/pages/:pageId/ai/conversations', async (request, reply) => {
    if (active.has(request.params.pageId)) return reply.code(409).send({ message: '请等当前生成结束后再清空对话' });
    db.delete(aiConversations).where(eq(aiConversations.pageId, request.params.pageId)).run();
    return { ok: true };
  });
  return { current, create, history };
}
