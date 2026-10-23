import type { FastifyInstance } from 'fastify';
import { createRepository, ManagementError } from './db/repository.js';
import { saveDocumentSchema } from './document-validation.js';
import { z } from 'zod';
import type { AuthService } from './auth.js';

export function registerApi(app: FastifyInstance, repository: ReturnType<typeof createRepository>, auth?: AuthService) {
  app.get('/api/health', async () => ({ status: 'ok', storage: 'sqlite', app: 'Forma' }));
  app.get<{ Querystring: { pageId?: string } }>('/api/bootstrap', async (request, reply) => {
    if (!auth) return repository.bootstrap(request.query.pageId);
    const user = request.identity!.user;
    const allowed = auth.allowedProjects(user);
    const available = allowed.flatMap(project => repository.listPages(project.id));
    const page = available.find(page => page.id === request.query.pageId) || available[0];
    if (!page) return reply.code(404).send({ message: '暂无可访问的项目，请创建项目或联系管理员' });
    return { ...repository.bootstrap(page.id), projectRole: auth.role(user, page.projectId) };
  });
  app.get('/api/projects', async request => ({ projects: auth ? auth.allowedProjects(request.identity!.user) : repository.listProjects() }));
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/pages', async request => ({ pages: repository.listPages(request.params.projectId) }));
  const name = z.string().trim().min(1).max(120);
  const manage = <T>(operation: () => T, reply: import('fastify').FastifyReply) => {
    try { return operation(); } catch (error) {
      if (error instanceof ManagementError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  };
  app.post('/api/projects', async (request, reply) => {
    const parsed = z.object({ name }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '请输入 1–120 字的项目名称' });
    return manage(() => auth ? auth.createProject(() => repository.createProject(parsed.data.name), request.identity!.user) : repository.createProject(parsed.data.name), reply);
  });
  app.patch<{ Params: { projectId: string } }>('/api/projects/:projectId', async (request, reply) => {
    const parsed = z.object({ name }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '项目名称不正确' });
    return manage(() => repository.renameProject(request.params.projectId, parsed.data.name), reply);
  });
  app.delete<{ Params: { projectId: string } }>('/api/projects/:projectId', async (request, reply) => manage(() => repository.deleteProject(request.params.projectId), reply));
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/pages', async (request, reply) => {
    const parsed = z.object({ name, parentId: z.string().min(1).max(200).nullable().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '页面名称或父页面不正确' });
    return manage(() => repository.createPage(request.params.projectId, parsed.data.name, parsed.data.parentId), reply);
  });
  app.patch<{ Params: { pageId: string } }>('/api/pages/:pageId', async (request, reply) => {
    const parsed = z.object({ name: name.optional(), parentId: z.string().min(1).max(200).nullable().optional(), order: z.enum(['up', 'down']).optional() })
      .refine(value => value.name !== undefined || value.parentId !== undefined || value.order !== undefined)
      .refine(value => !(value.parentId !== undefined && value.order !== undefined)).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '页面修改内容不正确' });
    return manage(() => repository.updatePage(request.params.pageId, parsed.data), reply);
  });
  app.post<{ Params: { pageId: string } }>('/api/pages/:pageId/duplicate', async (request, reply) => manage(() => repository.duplicatePage(request.params.pageId), reply));
  app.delete<{ Params: { pageId: string } }>('/api/pages/:pageId', async (request, reply) => manage(() => repository.deletePage(request.params.pageId), reply));
  app.get<{ Params: { pageId: string } }>('/api/pages/:pageId/document', async (request, reply) => {
    const document = repository.readDocument(request.params.pageId);
    return document || reply.code(404).send({ message: '页面不存在' });
  });
  app.put<{ Params: { pageId: string } }>('/api/pages/:pageId/document', async (request, reply) => {
    const parsed = saveDocumentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '原型数据格式不正确', issues: parsed.error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
    const result = repository.saveDocument(request.params.pageId, parsed.data.revision, parsed.data.document);
    if (result.status === 'missing') return reply.code(404).send({ message: '页面不存在' });
    if (result.status === 'conflict') return reply.code(409).send({ message: '页面已被其他窗口更新，请重新载入后编辑', revision: result.revision });
    return { revision: result.revision, updatedAt: result.updatedAt };
  });
}
