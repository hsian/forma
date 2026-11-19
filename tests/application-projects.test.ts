import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
import { registerAuth } from '../server/auth';
import { createApplicationWorkspace } from '../server/application-workspace';
import { makeElement } from '../shared/model';
import { nativeDirectoryCommand, type NativeDirectoryPicker } from '../server/native-directory-picker';

function fixture(authenticated = false, pickDirectory?: NativeDirectoryPicker) {
  mkdirSync('test-results', { recursive: true });
  const rootDirectory = mkdtempSync(resolve('test-results/application-projects-'));
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify();
  const auth = authenticated ? registerAuth(app, connection.db) : undefined;
  registerApi(app, repository, auth, { rootDirectory, pickDirectory });
  app.addHook('onClose', async () => connection.close());
  return { app, repository, rootDirectory };
}

test('模板工程初始化、页面同步、扩展保留以及独立构建', async () => {
  const f = fixture();
  try {
    const response = await f.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '客户管理', application: { templateId: 'admin', directoryName: 'customer-management' } } });
    assert.equal(response.statusCode, 200, response.body);
    const { project, page } = response.json();
    const directory = resolve(f.rootDirectory, 'customer-management');
    assert.equal(project.application.directory, directory);
    assert.equal(project.application.templateVersion, '1.1.0');
    const manifest = JSON.parse(readFileSync(resolve(directory, '.forma/project.json'), 'utf8'));
    assert.equal(manifest.projectId, project.id);
    const packageJson = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    assert.match(packageJson.dependencies.react, /^\d+\.\d+\.\d+$/);
    assert.ok(existsSync(resolve(directory, '.forma/runtime/src/PrototypePlayer.tsx')));
    assert.ok(!existsSync(resolve(directory, '.forma/runtime/server')));
    const extension = resolve(directory, 'src/utils/customer.ts');
    writeFileSync(extension, 'export const customerLabel = (name: string) => name.trim();\n');
    const config = resolve(directory, 'src/config/app.ts');
    const modifiedConfig = readFileSync(config, 'utf8').replace("title: ''", "title: '我的客户系统'");
    writeFileSync(config, modifiedConfig);
    const document = f.repository.readDocument(page.id)!;
    document.document.elements.push({ ...makeElement('text'), text: '同步后的客户页面' });
    f.repository.saveDocument(page.id, document.revision, document.document);
    const child = f.repository.createPage(project.id, '客户详情', page.id);
    f.repository.renameProject(project.id, '新的客户管理');
    const sync = await f.app.inject({ method: 'POST', url: `/api/projects/${project.id}/application/sync` });
    assert.equal(sync.statusCode, 200, sync.body);
    assert.equal(sync.json().pageCount, 2);
    const snapshot = JSON.parse(readFileSync(resolve(directory, '.forma/snapshot.json'), 'utf8'));
    assert.equal(snapshot.project.name, '新的客户管理');
    assert.equal(snapshot.pages[0].revision, 1);
    assert.equal(snapshot.pages[0].document.elements[0].text, '同步后的客户页面');
    assert.equal(snapshot.pages.find((item: { id: string }) => item.id === child.id).parentId, page.id);
    assert.equal(readFileSync(config, 'utf8'), modifiedConfig);
    assert.match(readFileSync(extension, 'utf8'), /customerLabel/);
    // 直接对产物进行类型检查与生产构建，发现缺失运行依赖、模板语法等问题。
    execFileSync(process.execPath, [resolve(directory, 'scripts/check-architecture.mjs')], { cwd: directory, stdio: 'pipe' });
    execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--project', resolve(directory, 'tsconfig.json')], { stdio: 'pipe' });
    execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', directory], { stdio: 'pipe' });
    assert.ok(existsSync(resolve(directory, 'dist/index.html')));
    await f.app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
    assert.ok(existsSync(extension), '删除原型项目不删除源码');
  } finally { await f.app.close(); }
});

test('拒绝覆盖、非法路径、未开放模板、损坏标识，并保留旧项目', async () => {
  const f = fixture();
  const create = (application: unknown) => f.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '校验工程', application } });
  try {
    assert.equal((await create({ templateId: 'mobile' })).statusCode, 400);
    for (const directoryName of ['../escape', 'C:\\escape', '.', 'CON', 'nul', 'has space']) assert.equal((await create({ templateId: 'admin', directoryName })).statusCode, 400, directoryName);
    const created = await create({ templateId: 'admin', directoryName: 'existing' });
    assert.equal(created.statusCode, 200, created.body);
    const { project } = created.json();
    assert.equal((await create({ templateId: 'admin', directoryName: 'existing' })).statusCode, 409);
    assert.equal(f.repository.listProjects().length, 2, '失败不产生空项目');
    const manifest = resolve(f.rootDirectory, 'existing/.forma/project.json');
    writeFileSync(manifest, JSON.stringify({ projectId: 'another-project' }));
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/projects/${project.id}/application/sync` })).statusCode, 409);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/projects/default-project/application/sync' })).statusCode, 409);
    assert.equal(f.repository.bootstrap('default-page').project.application, null);
  } finally { await f.app.close(); }
});

test('工程初始化失败时同步回滚数据库与新目录', () => {
  const f = fixture();
  const workspace = createApplicationWorkspace({ rootDirectory: f.rootDirectory });
  try {
    assert.throws(() => workspace.create('admin', 'failed-project', (application, initialize) => f.repository.createProject('失败项目', application, result => {
      initialize(f.repository.applicationSnapshot(result.project.id));
      throw Error('模拟初始化后失败');
    })), /模拟初始化后失败/);
    assert.equal(f.repository.listProjects().length, 1);
    assert.deepEqual(readdirSync(f.rootDirectory), []);
  } finally { void f.app.close(); }
});

test('根目录内既有子目录仍可初始化与同步，外部目录必须经过原生选择', async () => {
  const f = fixture();
  try {
    const parentDirectory = resolve(f.rootDirectory, '业务项目');
    mkdirSync(parentDirectory);
    const denied = await f.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '越界', application: { templateId: 'admin', parentDirectory: resolve(f.rootDirectory, '..') } } });
    assert.equal(denied.statusCode, 400);
    const created = await f.app.inject({ method: 'POST', url: '/api/projects', payload: { name: '选目录项目', application: { templateId: 'admin', parentDirectory } } });
    assert.equal(created.statusCode, 200, created.body);
    const { project } = created.json();
    assert.equal(project.application.parentDirectory, parentDirectory);
    assert.equal(project.application.directory, resolve(parentDirectory, project.application.directoryName));
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/projects/${project.id}/application/sync` })).statusCode, 200);
    assert.equal(f.repository.listProjects().length, 2);
  } finally { await f.app.close(); }
});

test('工程目录与同步沿用账号和项目权限', async () => {
  const f = fixture(true);
  const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, cookie = '', payload?: Record<string, unknown>) => f.app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
  const cookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  try {
    assert.equal((await request('GET', '/api/application-templates')).statusCode, 401);
    assert.equal((await request('POST', '/api/application-directories/pick')).statusCode, 401);
    const admin = cookie(await request('POST', '/api/auth/setup', '', { username: 'admin', password: 'password-123' }));
    const user = (await request('POST', '/api/admin/users', admin, { username: 'viewer', password: 'password-123' })).json().user;
    const viewer = cookie(await request('POST', '/api/auth/login', '', { username: 'viewer', password: 'password-123' }));
    const project = (await request('POST', '/api/projects', admin, { name: '受保护工程', application: { templateId: 'admin' } })).json().project;
    assert.equal((await request('GET', `/api/projects/${project.id}/application`, viewer)).statusCode, 403);
    await request('PUT', `/api/projects/${project.id}/members/${user.id}`, admin, { role: 'viewer' });
    assert.equal((await request('POST', `/api/projects/${project.id}/application/sync`, viewer)).statusCode, 403);
    assert.equal((await request('POST', `/api/projects/${project.id}/application/sync`, admin)).statusCode, 200);
    await request('PATCH', `/api/admin/users/${user.id}`, admin, { canCreateProject: false });
    assert.equal((await request('GET', '/api/application-templates', viewer)).statusCode, 403);
    assert.equal((await request('POST', '/api/application-directories/pick', viewer)).statusCode, 403);
    assert.equal((await request('POST', '/api/projects', viewer, { name: '无权创建', application: { templateId: 'admin' } })).statusCode, 403);
  } finally { await f.app.close(); }
});

test('原生目录选择支持取消、外部目录和持久同步，选择凭据绑定登录会话且不可重用', async () => {
  let selected: string | null = null;
  let calls = 0;
  const f = fixture(true, async () => { calls++; return selected; });
  const externalDirectory = mkdtempSync(resolve('test-results/native-selected-'));
  const cookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  try {
    const admin = cookie(await f.app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } }));
    const pick = () => f.app.inject({ method: 'POST', url: '/api/application-directories/pick', headers: { cookie: admin }, payload: {} });
    assert.deepEqual((await pick()).json(), { directory: null });
    selected = externalDirectory;
    const response = await pick();
    assert.equal(response.statusCode, 200, response.body);
    const selection = response.json();
    assert.equal(selection.directory, externalDirectory);
    const create = (session = admin, extra: Record<string, unknown> = {}) => f.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: session }, payload: { name: '原生目录工程', application: { templateId: 'admin', parentDirectory: externalDirectory, directoryToken: selection.directoryToken, ...extra } } });
    assert.equal((await create(admin, { directoryToken: undefined })).statusCode, 400, '只填任意外部路径不能绕过系统选择');
    const secondSession = cookie(await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'password-123' } }));
    assert.equal((await create(secondSession)).statusCode, 400, '不同登录会话不能使用选择凭据');
    assert.equal((await create(admin, { parentDirectory: f.rootDirectory })).statusCode, 400, '路径必须匹配系统所选位置');
    const created = await create();
    assert.equal(created.statusCode, 200, created.body);
    const { project } = created.json();
    assert.equal(project.application.directorySelection, 'native');
    assert.equal(project.application.parentDirectory, externalDirectory);
    assert.ok(existsSync(resolve(project.application.directory, '.forma/project.json')));
    assert.equal((await create()).statusCode, 400, '成功创建后凭据失效');
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/projects/${project.id}/application/sync`, headers: { cookie: admin } })).statusCode, 200);
    const callsBeforeRemote = calls;
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/application-directories/pick', headers: { cookie: admin }, remoteAddress: '192.0.2.4' })).statusCode, 400);
    assert.equal(calls, callsBeforeRemote, '局域网访问不能在服务电脑上打开系统窗口');
  } finally { await f.app.close(); }
});

test('Windows 原生文件夹窗口可初始化 Explorer COM 接口（不打开窗口）', { skip: process.platform !== 'win32' }, () => {
  const result = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', nativeDirectoryCommand(true)], {
    windowsHide: true, encoding: 'utf8', env: { ...process.env, FORMA_PICKER_INITIAL_DIRECTORY: resolve('test-results') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(JSON.parse(result.trim()).directory, 'validated');
});
