import { registerSketchApi } from './sketch/routes.js';
import { registerImagePrototype } from './ai/image-routes.js';
import type { FastifyInstance } from 'fastify';
import { createRepository, ManagementError } from './db/repository.js';
import { saveDocumentSchema } from './document-validation.js';
import { z } from 'zod';
import type { AuthService } from './auth.js';
import { VersionError } from './db/versions.js';

export function registerApi(app: FastifyInstance, repository: ReturnType<typeof createRepository>, auth?: AuthService) {
  registerSketchApi(app, repository, auth);
  registerImagePrototype(app, repository, auth);
  app.get('/api/health', async () => ({ status: 'ok', storage: 'sqlite', app: 'Forma' }));
  app.get<{ Querystring: { pageId?: string; projectId?: string } }>('/api/bootstrap', async (request, reply) => {
    if (!auth) return repository.bootstrap(request.query.pageId);
    const user = request.identity!.user;
    const allowed = auth.allowedProjects(user);
    const available = allowed.filter(project => !request.query.projectId || project.id === request.query.projectId).flatMap(project => repository.listPages(project.id));
    const page = available.find(page => page.id === request.query.pageId) || available[0];
    if (!page) return reply.code(404).send({ message: '暂无可访问的项目，请创建项目或联系管理员' });
    return { ...repository.bootstrap(page.id), projectRole: auth.role(user, page.projectId), permissions: auth.access(user, page.projectId)?.permissions || [], canCreateProject: user.role === 'admin' || !!user.canCreateProject };
  });
  app.get('/api/projects', async request => ({ projects: auth ? auth.allowedProjects(request.identity!.user).map(project => ({ ...project, projectRole: auth.role(request.identity!.user, project.id) })) : repository.listProjects() }));
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/pages', async request => ({ pages: repository.listPages(request.params.projectId) }));
  const name = z.string().trim().min(1).max(120);
  const manage = <T>(operation: () => T, reply: import('fastify').FastifyReply) => {
    try { return operation(); } catch (error) {
      if (error instanceof ManagementError || error instanceof VersionError) return reply.code(error.statusCode).send({ message: error.message });
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
  app.delete<{ Params: { projectId: string } }>('/api/projects/:projectId', async (request, reply) => manage(() => { const result = repository.deleteProject(request.params.projectId); repository.collectVersionBlobs(); return result; }, reply));
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/versions', async request => ({ versions: repository.listVersions(request.params.projectId) }));
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/versions/draft', async (request, reply) => manage(() => repository.draftVersionManifest(request.params.projectId), reply));
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/versions', async (request, reply) => {
    const parsed = z.object({ name, description: z.string().max(5000).default(''), stamp: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '请输入版本名称，并重新读取草稿状态' });
    return manage(() => repository.createVersion(request.params.projectId, parsed.data.name, parsed.data.description, request.identity?.user.username || '本地用户', parsed.data.stamp, () => {
      if (auth && repository.listPages(request.params.projectId).some(page => { const lease = auth.leaseInfo(request, page.id); return lease.expiresAt && !lease.owned; })) throw new VersionError('项目中有其他窗口正在编辑，请等待对方保存并释放编辑权后确认版本', 423);
    }), reply);
  });
  app.get<{ Params: { projectId: string; versionId: string } }>('/api/projects/:projectId/versions/:versionId', async (request, reply) => manage(() => repository.readVersion(request.params.projectId, request.params.versionId), reply));
  app.get<{ Params: { projectId: string; versionId: string; snapshotPageId: string } }>('/api/projects/:projectId/versions/:versionId/pages/:snapshotPageId', async (request, reply) => manage(() => repository.readVersionDocument(request.params.projectId, request.params.versionId, request.params.snapshotPageId), reply));
  app.get<{ Params: { projectId: string; versionId: string; hash: string } }>('/api/projects/:projectId/versions/:versionId/assets/:hash', async (request, reply) => {
    try { const asset = repository.readVersionAsset(request.params.projectId, request.params.versionId, request.params.hash); return reply.header('Content-Type', asset.mime).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; sandbox").send(Buffer.from(asset.data, 'base64')); }
    catch (error) { return manage(() => { throw error; }, reply); }
  });
  app.delete<{ Params: { projectId: string; versionId: string } }>('/api/projects/:projectId/versions/:versionId', async (request, reply) => manage(() => repository.deleteVersion(request.params.projectId, request.params.versionId), reply));
  app.post<{ Params: { projectId: string; versionId: string } }>('/api/projects/:projectId/versions/:versionId/copy', async (request, reply) => manage(() => auth ? auth.createProject(() => repository.copyVersion(request.params.projectId, request.params.versionId), request.identity!.user) : repository.copyVersion(request.params.projectId, request.params.versionId), reply));
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
  app.get<{ Params: { pageId: string } }>('/api/pages/:pageId/design', async (request, reply) => manage(() => ({ ...repository.designMetadata(request.params.pageId), boards: repository.listDesignBoards(request.params.pageId) }), reply));
  app.patch<{ Params: { pageId: string } }>('/api/pages/:pageId/design', async (request, reply) => {
    const parsed = z.object({ required: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: '请选择 UI 交付方式' });
    return manage(() => repository.setDesignRequired(request.params.pageId, parsed.data.required), reply);
  });
  app.get<{ Params: { pageId: string; designId: string } }>('/api/pages/:pageId/design/:designId', async (request, reply) => manage(() => repository.readDesignBoard(request.params.pageId, request.params.designId), reply));
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
