import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { registerApi } from '../server/api';
import { documents } from '../server/db/schema';
import { makeElement } from '../shared/model';
import type { ApplicationSyncStatus } from '../shared/application';
import { createApplicationWorkspace } from '../server/application-workspace';

async function fixture() {
  mkdirSync('test-results', { recursive: true });
  const rootDirectory = mkdtempSync(resolve('test-results/codegen-'));
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); registerApi(app, repository, undefined, { rootDirectory });
  app.addHook('onClose', async () => connection.close());
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '业务应用', application: { templateId: 'admin', directoryName: 'business' } } });
  assert.equal(created.statusCode, 200, created.body);
  const { project, page } = created.json();
  async function status() {
    const response = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/application` });
    return response.json().sync as ApplicationSyncStatus;
  }
  async function waitForState(state: ApplicationSyncStatus['state'], revision?: number) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const result = await status();
      if (result.state === state && (revision === undefined || result.publishedRevision >= revision)) return result;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    assert.fail(JSON.stringify(await status()));
  }
  async function synced() { return waitForState('synced', repository.applicationSyncStatus(project.id)!.revision); }
  return { app, repository, connection, project, page, directory: project.application.directory as string, status, synced, waitForState };
}

test('保存、后台直接写入、增删改名与复制自动生成独立 TSX 和路由，不覆盖开发者代码', async () => {
  const f = await fixture();
  try {
    let state = await f.synced();
    assert.equal(state.sourceFiles.length, 1);
    const homeFile = resolve(f.directory, state.sourceFiles[0].file);
    assert.match(readFileSync(homeFile, 'utf8'), /export default function Page_/);
    assert.match(readFileSync(resolve(f.directory, 'src/Application.tsx'), 'utf8'), /pages\/generated\/routes/);
    const serviceFile = resolve(f.directory, 'src/services/login.ts');
    writeFileSync(serviceFile, 'export const login = () => "custom-login";\n');
    const saved = f.repository.readDocument(f.page.id)!;
    saved.document.elements.push({ ...makeElement('text'), text: '账号登录' });
    const response = await f.app.inject({ method: 'PUT', url: `/api/pages/${f.page.id}/document`, payload: { revision: saved.revision, document: saved.document } });
    assert.equal(response.statusCode, 200, response.body);
    await f.synced();
    assert.match(readFileSync(homeFile, 'utf8'), /账号登录/);
    // The outbox also catches direct database writers, without calling a particular repository method.
    const aiDocument = f.repository.readDocument(f.page.id)!;
    aiDocument.document.elements[0].text = 'AI 已调整登录页面';
    f.connection.db.update(documents).set({ content: aiDocument.document, revision: aiDocument.revision + 1 }).where(eq(documents.pageId, f.page.id)).run();
    await f.synced();
    assert.match(readFileSync(homeFile, 'utf8'), /AI 已调整登录页面/);
    const child = f.repository.createPage(f.project.id, '详情/非法:文件名', f.page.id);
    state = await f.synced();
    const childFile = state.sourceFiles.find(item => item.pageId === child.id)!.file;
    assert.ok(!childFile.split('/').at(-1)!.includes(':'));
    assert.equal(childFile.split('/').length, 4);
    const copy = f.repository.duplicatePage(child.id);
    f.repository.updatePage(child.id, { name: '登录设置', parentId: null });
    state = await f.synced();
    assert.equal(state.sourceFiles.length, 3);
    assert.ok(!existsSync(resolve(f.directory, childFile)), '旧名称对应的受管文件被清理');
    const renamed = state.sourceFiles.find(item => item.pageId === child.id)!;
    assert.match(renamed.file, /登录设置/);
    const route = resolve(f.directory, 'src/pages/generated/routes.tsx');
    assert.match(readFileSync(route, 'utf8'), /登录设置/);
    f.repository.deletePage(copy.id);
    f.repository.renameProject(f.project.id, '新的应用名称');
    state = await f.synced();
    assert.equal(state.sourceFiles.length, 2);
    assert.match(readFileSync(route, 'utf8'), /新的应用名称/);
    assert.equal(readFileSync(serviceFile, 'utf8'), 'export const login = () => "custom-login";\n');
    assert.equal(readdirSync(resolve(f.directory, 'src/pages/generated')).filter(file => file.endsWith('.tsx')).length, 3);
    execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--project', resolve(f.directory, 'tsconfig.json')], { stdio: 'pipe' });
  } finally { await f.app.close(); }
});

test('生成冲突保留手写内容与原有路由，数据库保存仍成功，修复后可立即重试', async () => {
  const f = await fixture();
  try {
    const state = await f.synced();
    const source = resolve(f.directory, state.sourceFiles[0].file);
    const original = readFileSync(source, 'utf8');
    const route = resolve(f.directory, 'src/pages/generated/routes.tsx');
    const oldRoute = readFileSync(route, 'utf8');
    writeFileSync(source, original + '// 开发者手改，不能覆盖\n');
    const doc = f.repository.readDocument(f.page.id)!;
    doc.document.elements.push({ ...makeElement('text'), text: '页面必须先保存成功' });
    const saved = await f.app.inject({ method: 'PUT', url: `/api/pages/${f.page.id}/document`, payload: { revision: doc.revision, document: doc.document } });
    assert.equal(saved.statusCode, 200, saved.body);
    const failed = await f.waitForState('error');
    assert.match(failed.error!, /手写修改/);
    assert.match(readFileSync(source, 'utf8'), /开发者手改/);
    assert.equal(readFileSync(route, 'utf8'), oldRoute);
    assert.equal(f.repository.readDocument(f.page.id)!.document.elements[0].text, '页面必须先保存成功');
    writeFileSync(source, original);
    const retried = await f.app.inject({ method: 'POST', url: `/api/projects/${f.project.id}/application/sync` });
    assert.equal(retried.statusCode, 200, retried.body);
    assert.match(readFileSync(source, 'utf8'), /页面必须先保存成功/);
    assert.equal((await f.status()).state, 'synced');
  } finally { await f.app.close(); }
});

test('已有第一阶段工程自动补齐源码并迁移原始入口，自定义入口保留并给出接入提示', async () => {
  const f = await fixture();
  try {
    const state = await f.synced();
    const sourceDirectory = resolve(f.directory, 'src/pages/generated');
    for (const file of readdirSync(sourceDirectory)) unlinkSync(resolve(sourceDirectory, file));
    unlinkSync(resolve(f.directory, '.forma/generated-files.json'));
    const legacy = readFileSync('templates/migrations/admin-v1/Application.tsx', 'utf8');
    const entry = resolve(f.directory, 'src/Application.tsx');
    writeFileSync(entry, legacy);
    f.repository.requestApplicationSync(f.project.id);
    await f.synced();
    assert.ok(existsSync(resolve(f.directory, state.sourceFiles[0].file)));
    assert.match(readFileSync(entry, 'utf8'), /pages\/generated\/routes/);
    const custom = legacy + '\n// 自定义导航行为\n';
    writeFileSync(entry, custom);
    f.repository.requestApplicationSync(f.project.id);
    const next = await f.synced();
    assert.equal(readFileSync(entry, 'utf8'), custom);
    assert.match(next.warning!, /自定义修改/);
  } finally { await f.app.close(); }
});

test('未关联原型项目、失败事务与删除项目不留下自动生成任务', async () => {
  const f = await fixture();
  try {
    await f.synced();
    f.repository.createPage('default-project', '普通原型页');
    assert.equal(f.repository.applicationSyncStatus('default-project'), null);
    const revision = (await f.status()).revision;
    assert.throws(() => f.connection.db.transaction(() => { f.repository.createPage(f.project.id, '回滚页面'); throw Error('回滚'); }), /回滚/);
    assert.equal((await f.status()).revision, revision);
    f.repository.deleteProject(f.project.id);
    assert.equal(f.repository.applicationSyncStatus(f.project.id), null);
    assert.ok(existsSync(resolve(f.directory, '.forma/project.json')));
  } finally { await f.app.close(); }
});

test('上版默认导航入口自动改为原设计展示，开发者配置和自定义入口保留', async () => {
  const f = await fixture();
  try {
    await f.synced();
    const entry = resolve(f.directory, 'src/Application.tsx');
    const previous = readFileSync('templates/migrations/admin-v2/Application.tsx', 'utf8');
    const config = resolve(f.directory, 'src/config/app.ts');
    // Simulate the previous version, whose config did not define layout.
    const oldConfig = readFileSync(config, 'utf8').split('\n').filter(line => !line.includes('layout:')).join('\n');
    writeFileSync(config, oldConfig);
    writeFileSync(entry, previous);
    f.repository.requestApplicationSync(f.project.id);
    await f.synced();
    assert.match(readFileSync(entry, 'utf8'), /data-application-layout="page"/);
    assert.equal(readFileSync(config, 'utf8'), oldConfig);
    const earlyEntry = previous.replace('[pageId, pages]', '[pageId]').replace('key={`${page.id}:${page.revision}`}', 'key={page.id}');
    writeFileSync(entry, earlyEntry);
    f.repository.requestApplicationSync(f.project.id);
    await f.synced();
    assert.match(readFileSync(entry, 'utf8'), /data-application-layout="page"/);
    assert.equal(readFileSync(config, 'utf8'), oldConfig);
    execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '--project', resolve(f.directory, 'tsconfig.json')], { stdio: 'pipe' });
    const custom = previous + '\n// 开发者自定义布局\n';
    writeFileSync(entry, custom);
    f.repository.requestApplicationSync(f.project.id);
    await f.synced();
    assert.equal(readFileSync(entry, 'utf8'), custom);
    assert.match(f.repository.applicationSyncStatus(f.project.id)!.warning!, /旧版导航框架/);
  } finally { await f.app.close(); }
});

test('服务重启后自动补生成停机期间保存的页面，不需要手动同步', async () => {
  const root = mkdtempSync(resolve('test-results/codegen-restart-'));
  const databaseFile = resolve(root, 'application.db');
  const rootDirectory = resolve(root, 'projects');
  let connection = openDatabase(databaseFile);
  let repository = createRepository(connection.db); repository.initialize();
  const workspace = createApplicationWorkspace({ rootDirectory });
  const created = workspace.create('admin', 'existing', (application, initialize) => repository.createProject('已有工程', application, result => initialize(repository.applicationSnapshot(result.project.id))));
  const saved = repository.readDocument(created.page.id)!;
  saved.document.elements.push({ ...makeElement('text'), text: '重启后自动生成的登录页' });
  repository.saveDocument(created.page.id, saved.revision, saved.document);
  connection.close();
  connection = openDatabase(databaseFile); repository = createRepository(connection.db);
  const app = Fastify(); registerApi(app, repository, undefined, { rootDirectory });
  app.addHook('onClose', async () => connection.close());
  try {
    await app.ready();
    const deadline = Date.now() + 8000;
    while (repository.applicationSyncStatus(created.project.id)?.state !== 'synced' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 80));
    const state = repository.applicationSyncStatus(created.project.id)!;
    assert.equal(state.state, 'synced');
    assert.match(readFileSync(resolve(rootDirectory, 'existing', state.sourceFiles[0].file), 'utf8'), /重启后自动生成的登录页/);
  } finally { await app.close(); }
});
