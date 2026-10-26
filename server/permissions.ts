import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDatabase } from './db/index.js';
import { users, projects, projectMembers, projectRoles, permissionAudit, pageLeases, pages, sessions } from './db/schema.js';
import { allPermissions, builtinRoles, type AuthUser, type Permission, type PermissionRole, type ProjectRole } from '../shared/auth.js';

export function permissionService(db: AppDatabase, now: () => number) {
  const roles = (projectId: string): PermissionRole[] => [...builtinRoles, ...db.select().from(projectRoles).where(eq(projectRoles.projectId, projectId)).all().map(item => ({ ...item, builtin: false }))];
  function access(user: AuthUser, projectId: string) {
    const current = db.select().from(users).where(eq(users.id, user.id)).get();
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!current?.enabled || !project) return undefined;
    if (current.role === 'admin' || project.ownerId === user.id) return builtinRoles.find(role => role.id === 'admin');
    const member = db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id))).get();
    const result = member && roles(projectId).find(role => role.id === (member.customRoleId || member.role));
    return result?.id === 'admin' && !project.legacyAdminDelete ? { ...result, permissions: result.permissions.filter(id => id !== 'project.delete') } : result;
  }
  const can = (user: AuthUser, projectId: string, permission: Permission) => !!access(user, projectId)?.permissions.includes(permission);
  const role = (user: AuthUser, projectId: string): ProjectRole | undefined => { const result = access(user, projectId); return !result ? undefined : result.id === 'admin' ? 'admin' : result.permissions.includes('prototype.edit') ? 'editor' : 'viewer'; };
  const audit = (request: FastifyRequest, projectId: string | null, action: string, target: string, detail: unknown) => db.insert(permissionAudit).values({ id: randomUUID(), projectId, actor: request.identity!.user.username, action, target, detail: JSON.stringify(detail), createdAt: now() }).run();
  function release(userId: string, projectId?: string) {
    if (!projectId) { db.delete(pageLeases).where(eq(pageLeases.userId, userId)).run(); return; }
    for (const page of db.select().from(pages).where(eq(pages.projectId, projectId)).all()) db.delete(pageLeases).where(and(eq(pageLeases.userId, userId), eq(pageLeases.pageId, page.id))).run();
  }
  return { roles, access, can, role, audit, release };
}

export function registerPermissionRoutes(app: FastifyInstance, db: AppDatabase, service: ReturnType<typeof permissionService>, now: () => number, passwordHash: (password: string) => Promise<string>) {
  const fail = (reply: import('fastify').FastifyReply, code: number, message: string) => reply.code(code).send({ message });
  const admin = (request: FastifyRequest, projectId: string) => service.role(request.identity!.user, projectId) === 'admin';
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/permissions', async request => ({ permissions: service.access(request.identity!.user, request.params.projectId)?.permissions || [], role: service.access(request.identity!.user, request.params.projectId), canCreateProject: request.identity!.user.role === 'admin' || !!request.identity!.user.canCreateProject }));
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/roles', async (request, reply) => {
    if (!admin(request, request.params.projectId)) return fail(reply, 403, '仅项目管理员可查看角色配置');
    return { roles: service.roles(request.params.projectId) };
  });
  const roleInput = z.object({ name: z.string().trim().min(1).max(40), description: z.string().trim().max(300), permissions: z.array(z.enum(allPermissions as [Permission, ...Permission[]])).max(allPermissions.length), revision: z.number().int().positive().optional() }).strict();
  for (const method of ['POST', 'PUT'] as const) app.route<{ Params: { projectId: string; roleId?: string } }>({ method, url: `/api/projects/:projectId/roles${method === 'PUT' ? '/:roleId' : ''}`, handler: async (request, reply) => {
    const { projectId, roleId } = request.params;
    if (!admin(request, projectId)) return fail(reply, 403, '仅项目管理员可管理角色');
    const input = roleInput.safeParse(request.body);
    if (!input.success) return fail(reply, 400, '请检查角色名称、说明和权限');
    if (!input.data.permissions.includes('prototype.read')) return fail(reply, 400, '项目角色必须包含查看权限');
    if (input.data.permissions.includes('member.manage') || input.data.permissions.includes('project.delete')) return fail(reply, 400, '成员管理和项目删除不能授予自定义角色');
    const before = roleId && db.select().from(projectRoles).where(and(eq(projectRoles.id, roleId), eq(projectRoles.projectId, projectId))).get();
    if (method === 'PUT' && !before) return fail(reply, 404, '自定义角色不存在，内置角色不可修改');
    if (before && input.data.revision !== before.revision) return fail(reply, 409, '角色已被其他管理员修改，请重新选择角色后再编辑');
    if (service.roles(projectId).some(role => role.name === input.data.name && role.id !== roleId)) return fail(reply, 409, '角色名称已存在');
    const id = roleId || randomUUID();
    db.transaction(() => {
      const data = { name: input.data.name, description: input.data.description, permissions: [...new Set(input.data.permissions)], revision: before ? before.revision + 1 : 1 };
      if (before) db.update(projectRoles).set(data).where(eq(projectRoles.id, id)).run();
      else db.insert(projectRoles).values({ id, projectId, ...data }).run();
      if (before && !data.permissions.includes('prototype.edit')) for (const member of db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.customRoleId, id))).all()) service.release(member.userId, projectId);
      service.audit(request, projectId, before ? '修改角色' : '创建角色', data.name, { before: before || null, after: data });
    });
    return { ok: true, id };
  } });
  app.delete<{ Params: { projectId: string; roleId: string } }>('/api/projects/:projectId/roles/:roleId', async (request, reply) => {
    const { projectId, roleId } = request.params;
    if (!admin(request, projectId)) return fail(reply, 403, '仅项目管理员可删除角色');
    const old = db.select().from(projectRoles).where(and(eq(projectRoles.id, roleId), eq(projectRoles.projectId, projectId))).get();
    if (!old) return fail(reply, 404, '自定义角色不存在，内置角色不可删除');
    const input = z.object({ replacement: z.string().min(1) }).safeParse(request.body);
    const replacement = input.success && service.roles(projectId).find(role => role.id === input.data.replacement && role.id !== roleId);
    if (!replacement) return fail(reply, 400, '请选择有效的替代角色');
    db.transaction(() => {
      const members = db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.customRoleId, roleId))).all();
      for (const member of members) { db.update(projectMembers).set({ role: replacement.id === 'admin' ? 'admin' : replacement.permissions.includes('prototype.edit') ? 'editor' : 'viewer', customRoleId: replacement.builtin && ['admin', 'editor', 'viewer'].includes(replacement.id) ? null : replacement.id }).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, member.userId))).run(); service.release(member.userId, projectId); }
      db.delete(projectRoles).where(eq(projectRoles.id, roleId)).run();
      service.audit(request, projectId, '删除角色', old.name, { replacement: replacement.name, affected: members.length });
    });
    return { ok: true };
  });
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/owner', async (request, reply) => {
    const project = db.select().from(projects).where(eq(projects.id, request.params.projectId)).get()!;
    if (request.identity!.user.role !== 'admin' && project.ownerId !== request.identity!.user.id) return fail(reply, 403, '仅项目所有者或系统管理员可转交项目');
    const input = z.object({ userId: z.string() }).safeParse(request.body);
    const member = input.success && db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, input.data.userId))).get();
    const target = member && db.select().from(users).where(eq(users.id, member.userId)).get();
    if (!target || !target.enabled) return fail(reply, 400, '请选择已启用的项目成员');
    db.transaction(() => {
      db.update(projects).set({ ownerId: target.id }).where(eq(projects.id, project.id)).run();
      db.update(projectMembers).set({ role: 'admin', customRoleId: null }).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, target.id))).run();
      service.audit(request, project.id, '转交所有权', target.username, { before: project.ownerId ? db.select().from(users).where(eq(users.id, project.ownerId)).get()?.username : null, after: target.username });
    });
    return { ok: true };
  });
  app.get('/api/admin/users', async (request, reply) => {
    if (request.identity!.user.role !== 'admin') return fail(reply, 403, '需要系统管理员权限');
    return { users: db.select().from(users).all().map(({ passwordHash: _passwordHash, ...user }) => user) };
  });
  app.patch<{ Params: { userId: string } }>('/api/admin/users/:userId', async (request, reply) => {
    if (request.identity!.user.role !== 'admin') return fail(reply, 403, '需要系统管理员权限');
    const input = z.object({ enabled: z.boolean().optional(), canCreateProject: z.boolean().optional(), password: z.string().min(8).max(128).optional() }).strict().safeParse(request.body);
    if (!input.success || !Object.keys(input.data).length) return fail(reply, 400, '账号配置不正确，密码需 8–128 位');
    const encoded = input.data.password ? await passwordHash(input.data.password) : undefined;
    // Hashing is asynchronous: recheck the actor after it completes.
    const actorSession = db.select().from(sessions).where(eq(sessions.tokenHash, request.identity!.sessionHash)).get();
    const actor = db.select().from(users).where(eq(users.id, request.identity!.user.id)).get();
    if (!actorSession || actorSession.expiresAt <= now() || !actor?.enabled || actor.role !== 'admin') return fail(reply, 401, '请重新登录');
    const target = db.select().from(users).where(eq(users.id, request.params.userId)).get();
    if (!target) return fail(reply, 404, '账号不存在');
    if (input.data.enabled === false && (target.id === actor.id || target.role === 'admin' && db.select().from(users).all().filter(user => user.enabled && user.role === 'admin').length <= 1)) return fail(reply, 400, '不能停用自己或最后一位系统管理员');
    db.transaction(() => {
      const { password: _password, ...changes } = input.data;
      db.update(users).set({ ...changes, ...(encoded ? { passwordHash: encoded } : {}) }).where(eq(users.id, target.id)).run();
      if (encoded || input.data.enabled === false) { service.release(target.id); db.delete(sessions).where(eq(sessions.userId, target.id)).run(); }
      service.audit(request, null, encoded ? '重置密码' : '修改账号', target.username, { before: { enabled: target.enabled, canCreateProject: target.canCreateProject }, after: { ...changes, ...(encoded ? { passwordReset: true } : {}) } });
    });
    return { ok: true };
  });
  for (const scope of ['project', 'system'] as const) app.get<{ Params: { projectId: string } }>(scope === 'project' ? '/api/projects/:projectId/audit' : '/api/admin/audit', async (request, reply) => {
    if (scope === 'project' ? !admin(request, request.params.projectId) : request.identity!.user.role !== 'admin') return fail(reply, 403, '需要管理员权限');
    return { entries: db.select().from(permissionAudit).where(scope === 'project' ? eq(permissionAudit.projectId, request.params.projectId) : isNull(permissionAudit.projectId)).orderBy(desc(permissionAudit.createdAt), desc(permissionAudit.id)).limit(500).all() };
  });
}
