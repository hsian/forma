import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from './db/index.js';
import { users, sessions, projects, projectMembers, pages, pageLeases } from './db/schema.js';
import type { AuthUser } from '../shared/auth.js';
import { permissionService, registerPermissionRoutes } from './permissions.js';

declare module 'fastify' { interface FastifyRequest { identity: { user: AuthUser; sessionHash: string } | null } }
const username = z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_.-]+$/u).transform(value => value.toLowerCase());
const credentials = z.object({ username, password: z.string().min(8).max(128) });
const clientId = z.string().uuid();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeUser = (user: typeof users.$inferSelect): AuthUser => ({ id: user.id, username: user.username, role: user.role, enabled: user.enabled, canCreateProject: user.canCreateProject, createdAt: user.createdAt });
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
export async function passwordHash(password: string) { const salt = randomBytes(16).toString('hex'); return salt + ':' + (await derive(password, salt)).toString('hex'); }
async function verify(password: string, stored: string) { const [salt, encoded] = stored.split(':'); const expected = Buffer.from(encoded, 'hex'); const actual = await derive(password, salt); return expected.length === actual.length && timingSafeEqual(expected, actual); }

export function registerAuth(app: FastifyInstance, db: AppDatabase, now = Date.now) {
  app.decorateRequest('identity', null);
  const permissions = permissionService(db, now);
  const { role, can } = permissions;
  registerPermissionRoutes(app, db, permissions, now, passwordHash);
  const allowedProjects = (user: AuthUser) => db.select().from(projects).all().filter(project => !!role(user, project.id));
  const fail = (reply: FastifyReply, code: number, message: string) => reply.code(code).send({ message });
  const owns = (request: FastifyRequest, lease: typeof pageLeases.$inferSelect) => lease.sessionHash === request.identity?.sessionHash && lease.clientId === request.headers['x-forma-client-id'];
  function leaseInfo(request: FastifyRequest, pageId: string) {
    const lease = db.select().from(pageLeases).where(and(eq(pageLeases.pageId, pageId), gt(pageLeases.expiresAt, now()))).get();
    return lease ? { owned: owns(request, lease), username: db.select().from(users).where(eq(users.id, lease.userId)).get()?.username, expiresAt: lease.expiresAt } : { owned: false };
  }
  function checkLease(request: FastifyRequest, pageId: string) { return leaseInfo(request, pageId).owned; }
  // Authentication attempts are bounded per client address, including concurrent password hashing.
  const attempts = new Map<string, { count: number; until: number }>();
  function limit(request: FastifyRequest, reply: FastifyReply) {
    const key = request.ip; let entry = attempts.get(key);
    if (!entry || entry.until <= now()) { entry = { count: 0, until: now() + 15 * 60000 }; attempts.set(key, entry); }
    if (++entry.count > 15) { fail(reply, 429, '登录尝试过多，请 15 分钟后重试'); return false; }
    if (attempts.size > 10000) for (const [address, item] of attempts) if (item.until <= now()) attempts.delete(address);
    return true;
  }
  function startSession(user: AuthUser, request: FastifyRequest, reply: FastifyReply) {
    db.delete(sessions).where(lt(sessions.expiresAt, now())).run();
    const token = randomBytes(32).toString('base64url');
    db.insert(sessions).values({ tokenHash: hash(token), userId: user.id, expiresAt: now() + 7 * 86400000 }).run();
    reply.header('Set-Cookie', `forma_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${request.protocol === 'https' ? '; Secure' : ''}`);
    return { user };
  }
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      if (origin) { try { if (new URL(origin).host !== request.headers.host) return fail(reply, 403, '请求来源不正确'); } catch { return fail(reply, 403, '请求来源不正确'); } }
      if (request.headers['sec-fetch-site'] === 'cross-site') return fail(reply, 403, '请求来源不正确');
    }
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('forma_session='))?.slice(14);
    if (cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie)) {
      const session = db.select().from(sessions).where(and(eq(sessions.tokenHash, hash(cookie)), gt(sessions.expiresAt, now()))).get();
      const user = session && db.select().from(users).where(eq(users.id, session.userId)).get();
      if (session && user?.enabled) request.identity = { user: safeUser(user), sessionHash: session.tokenHash };
    }
    if (['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup'].includes(path)) return;
    if (!request.identity) return fail(reply, 401, '请先登录');
  });
  // Recheck authorization after request bodies have been received, immediately before handlers.
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!path.startsWith('/api/') || ['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup'].includes(path)) return;
    if (!request.identity || !db.select().from(sessions).where(and(eq(sessions.tokenHash, request.identity.sessionHash), gt(sessions.expiresAt, now()))).get()) return fail(reply, 401, '请先登录');
    const freshUser = db.select().from(users).where(eq(users.id, request.identity.user.id)).get();
    if (!freshUser?.enabled) return fail(reply, 401, '账号已停用');
    request.identity.user = safeUser(freshUser);
    const user = request.identity.user;
    if (request.method === 'POST' && (path === '/api/projects' || path.endsWith('/copy')) && user.role !== 'admin' && !user.canCreateProject) return fail(reply, 403, '此账号没有创建项目权限');
    const params = (request.params || {}) as { projectId?: string; pageId?: string };
    let projectId = params.projectId;
    if (params.pageId) {
      const page = db.select().from(pages).where(eq(pages.id, params.pageId)).get();
      if (!page) return fail(reply, 404, '页面不存在'); projectId = page.projectId;
    }
    if (projectId) {
      const access = role(user, projectId);
      if (!access) return fail(reply, 403, '没有此项目的访问权限');
      if (!['GET', 'HEAD'].includes(request.method)) {
        const designAnalysis = request.method === 'POST' && /^\/api\/pages\/[^/]+\/design\/[^/]+\/ai\/turn$/.test(path);
        const required = path.includes('/members') || path.includes('/roles') || path.endsWith('/owner') ? 'member.manage'
          : path.includes('/sketch') ? 'sketch.import'
          : path.includes('/versions') ? path.endsWith('/copy') ? 'version.copy' : request.method === 'DELETE' ? 'version.delete' : 'version.publish'
          : path === `/api/projects/${projectId}` ? request.method === 'DELETE' ? 'project.delete' : 'project.update'
          : path.endsWith('/document') || path.includes('/ai/') || path.endsWith('/lease') ? 'prototype.edit'
          : request.method === 'DELETE' ? 'page.delete' : 'page.manage';
        if (!designAnalysis && !can(user, projectId, required)) return fail(reply, 403, required === 'project.delete' && access === 'admin' ? '仅项目所有者或系统管理员可删除此项目' : '没有此操作权限，请联系项目管理员');
        if (params.pageId && !designAnalysis && !path.endsWith('/lease') && !path.endsWith('/duplicate')) {
          const lease = leaseInfo(request, params.pageId);
          const needsLease = path.endsWith('/document') || path.includes('/ai/');
          if ((needsLease && !lease.owned) || (!lease.owned && lease.expiresAt)) return fail(reply, 423, lease.username ? `${lease.username} 正在编辑此页面` : '请先取得页面编辑权');
        }
        if (request.method === 'DELETE' && path === `/api/projects/${projectId}`) {
          const projectPages = db.select().from(pages).where(eq(pages.projectId, projectId)).all();
          if (projectPages.some(page => { const lease = leaseInfo(request, page.id); return lease.expiresAt && !lease.owned; })) return fail(reply, 423, '项目中有其他窗口正在编辑，请稍后删除');
        }
        if (request.method === 'DELETE' && params.pageId && path === `/api/pages/${params.pageId}`) {
          const all = db.select().from(pages).where(eq(pages.projectId, projectId)).all();
          const removed = new Set([params.pageId]);
          for (let changed = true; changed;) { changed = false; for (const page of all) if (page.parentId && removed.has(page.parentId) && !removed.has(page.id)) { removed.add(page.id); changed = true; } }
          if ([...removed].some(id => { const lease = leaseInfo(request, id); return lease.expiresAt && !lease.owned; })) return fail(reply, 423, '此页面或子页面正在其他窗口中编辑');
        }
      }
    }
  });
  app.get('/api/auth/status', async request => ({ setupRequired: !db.select({ id: users.id }).from(users).limit(1).get(), user: request.identity?.user || null }));
  app.post('/api/auth/setup', async (request, reply) => {
    if (!limit(request, reply)) return;
    const input = credentials.safeParse(request.body);
    if (!input.success) return fail(reply, 400, '用户名需 2–32 位，密码需 8–128 位');
    const encoded = await passwordHash(input.data.password);
    const user = db.transaction(tx => {
      if (tx.select({ id: users.id }).from(users).limit(1).get()) return null;
      const user = { id: randomUUID(), username: input.data.username, passwordHash: encoded, role: 'admin' as const, enabled: true, canCreateProject: true, createdAt: now() };
      tx.insert(users).values(user).run();
      tx.update(projects).set({ ownerId: user.id }).where(isNull(projects.ownerId)).run();
      for (const project of tx.select().from(projects).all()) tx.insert(projectMembers).values({ projectId: project.id, userId: user.id, role: 'admin' }).onConflictDoNothing().run();
      return safeUser(user);
    });
    if (!user) return fail(reply, 409, '管理员已创建，请使用已有账号登录');
    attempts.delete(request.ip); return startSession(user, request, reply);
  });
  app.post('/api/auth/login', async (request, reply) => {
    if (!limit(request, reply)) return;
    const input = credentials.safeParse(request.body);
    if (!input.success) return fail(reply, 400, '请输入正确的用户名和密码');
    const user = db.select().from(users).where(eq(users.username, input.data.username)).get();
    // Hash even when the account is absent to avoid a cheap account-existence timing signal.
    const valid = user ? await verify(input.data.password, user.passwordHash) : (await derive(input.data.password, 'forma-missing-account'), false);
    if (!user?.enabled || !valid) return fail(reply, 401, '用户名或密码不正确');
    const current = db.select().from(users).where(eq(users.id, user.id)).get();
    if (!current?.enabled || current.passwordHash !== user.passwordHash) return fail(reply, 401, '账号状态已变化，请重新登录');
    attempts.delete(request.ip); return startSession(safeUser(current), request, reply);
  });
  app.post('/api/auth/logout', async (request, reply) => {
    db.delete(sessions).where(eq(sessions.tokenHash, request.identity!.sessionHash)).run();
    reply.header('Set-Cookie', 'forma_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'); return { ok: true };
  });
  app.get('/api/users', async (request, reply) => {
    const user = request.identity!.user;
    if (user.role !== 'admin' && !allowedProjects(user).some(p => role(user, p.id) === 'admin')) return fail(reply, 403, '需要管理员权限');
    return { users: db.select().from(users).all().map(item => ({ id: item.id, username: item.username, role: item.role, enabled: item.enabled })) };
  });
  app.post('/api/admin/users', async (request, reply) => {
    if (request.identity!.user.role !== 'admin') return fail(reply, 403, '需要系统管理员权限');
    const input = credentials.safeParse(request.body);
    if (!input.success) return fail(reply, 400, '用户名需 2–32 位，密码需 8–128 位');
    const encoded = await passwordHash(input.data.password);
    const actorSession = db.select().from(sessions).where(and(eq(sessions.tokenHash, request.identity!.sessionHash), gt(sessions.expiresAt, now()))).get();
    const actor = db.select().from(users).where(eq(users.id, request.identity!.user.id)).get();
    if (!actorSession || !actor?.enabled || actor.role !== 'admin') return fail(reply, 401, '请重新登录');
    try {
      const user = { id: randomUUID(), username: input.data.username, passwordHash: encoded, role: 'member' as const, enabled: true, canCreateProject: true, createdAt: now() };
      db.transaction(() => { db.insert(users).values(user).run(); permissions.audit(request, null, '创建账号', user.username, { role: 'member' }); }); return { user: safeUser(db.select().from(users).where(eq(users.id, user.id)).get()!) };
    } catch (error) { if (db.select().from(users).where(eq(users.username, input.data.username)).get()) return fail(reply, 409, '用户名已存在'); throw error; }
  });
  app.get<{ Params: { projectId: string } }>('/api/projects/:projectId/members', async (request, reply) => {
    if (role(request.identity!.user, request.params.projectId) !== 'admin') return fail(reply, 403, '需要项目管理员权限');
    return { members: db.select().from(projectMembers).where(eq(projectMembers.projectId, request.params.projectId)).all().map(member => { const account = db.select().from(users).where(eq(users.id, member.userId)).get(); return { ...member, effectivePermissions: account ? permissions.access(safeUser(account), request.params.projectId)?.permissions || [] : [] }; }), ownerId: db.select().from(projects).where(eq(projects.id, request.params.projectId)).get()?.ownerId };
  });
  app.put<{ Params: { projectId: string; userId: string } }>('/api/projects/:projectId/members/:userId', async (request, reply) => {
    const input = z.object({ role: z.string().min(1).max(100).nullable() }).safeParse(request.body);
    if (!input.success) return fail(reply, 400, '项目角色不正确');
    const project = db.select().from(projects).where(eq(projects.id, request.params.projectId)).get()!;
    if (project.ownerId === request.params.userId && input.data.role !== 'admin') return fail(reply, 400, '不能移除或降低项目创建者权限');
    if (!db.select().from(users).where(eq(users.id, request.params.userId)).get()) return fail(reply, 404, '用户不存在');
    const selected = input.data.role && permissions.roles(project.id).find(role => role.id === input.data.role);
    if (input.data.role && !selected) return fail(reply, 400, '项目角色不存在');
    const target = db.select().from(users).where(eq(users.id, request.params.userId)).get()!;
    if (selected && !target.enabled) return fail(reply, 400, '请先启用此账号，再添加项目权限');
    if (target.role === 'admin') return fail(reply, 400, '系统管理员拥有全部项目权限，无需单独授权');
    const before = db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, target.id))).get();
    db.transaction(() => {
      if (selected) {
        const value = { role: selected.id === 'admin' ? 'admin' as const : selected.permissions.includes('prototype.edit') ? 'editor' as const : 'viewer' as const, customRoleId: ['admin', 'editor', 'viewer'].includes(selected.id) ? null : selected.id };
        db.insert(projectMembers).values({ projectId: project.id, userId: target.id, ...value }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: value }).run();
      } else db.delete(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, target.id))).run();
      if (!selected || !selected.permissions.includes('prototype.edit')) permissions.release(target.id, project.id);
      permissions.audit(request, project.id, selected ? '分配角色' : '移除成员', target.username, { before: permissions.roles(project.id).find(role => role.id === (before?.customRoleId || before?.role))?.name || null, after: selected ? selected.name : null });
    });
    return { ok: true };
  });
  app.get<{ Params: { pageId: string } }>('/api/pages/:pageId/lease', async request => ({ lease: leaseInfo(request, request.params.pageId) }));
  app.post<{ Params: { pageId: string } }>('/api/pages/:pageId/lease', async (request, reply) => {
    const parsed = clientId.safeParse(request.headers['x-forma-client-id']);
    if (!parsed.success) return fail(reply, 400, '缺少有效的编辑窗口标识');
    const acquired = db.transaction(tx => {
      tx.delete(pageLeases).where(lt(pageLeases.expiresAt, now())).run();
      const current = tx.select().from(pageLeases).where(eq(pageLeases.pageId, request.params.pageId)).get();
      if (current && current.expiresAt > now() && !owns(request, current)) return false;
      tx.insert(pageLeases).values({ pageId: request.params.pageId, userId: request.identity!.user.id, sessionHash: request.identity!.sessionHash, clientId: parsed.data, expiresAt: now() + 90000 }).onConflictDoUpdate({ target: pageLeases.pageId, set: { expiresAt: now() + 90000, userId: request.identity!.user.id, sessionHash: request.identity!.sessionHash, clientId: parsed.data } }).run();
      return true;
    });
    return reply.code(acquired ? 200 : 423).send({ lease: leaseInfo(request, request.params.pageId), ...(acquired ? {} : { message: '此页面正在其他窗口中编辑' }) });
  });
  app.delete<{ Params: { pageId: string } }>('/api/pages/:pageId/lease', async request => {
    if (checkLease(request, request.params.pageId)) db.delete(pageLeases).where(eq(pageLeases.pageId, request.params.pageId)).run(); return { ok: true };
  });
  function onProjectCreated(projectId: string, user: AuthUser) {
    db.update(projects).set({ ownerId: user.id }).where(eq(projects.id, projectId)).run();
    db.insert(projectMembers).values({ projectId, userId: user.id, role: 'admin' }).run();
  }
  function createProject<T extends { project: { id: string } }>(create: () => T, user: AuthUser) {
    return db.transaction(() => { const result = create(); onProjectCreated(result.project.id, user); return result; });
  }
  return { role, can, projectRoles: permissions.roles, access: permissions.access, allowedProjects, checkLease, leaseInfo, createProject };
}
export type AuthService = ReturnType<typeof registerAuth>;
