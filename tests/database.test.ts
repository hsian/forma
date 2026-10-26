import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { openDatabase } from '../server/db';
import { createRepository, defaultPageId } from '../server/db/repository';
import { registerApi } from '../server/api';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { seedDocument } from '../shared/model';
import { permissionService } from '../server/permissions';

test('权限升级保留已有账号、项目归属和编辑成员能力，重复迁移不改变授权', () => {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/permissions-upgrade-'));
  const migrations = resolve(directory, 'old-migrations');
  mkdirSync(resolve(migrations, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  journal.entries = journal.entries.slice(0, 5);
  writeFileSync(resolve(migrations, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(`drizzle/${entry.tag}.sql`, resolve(migrations, `${entry.tag}.sql`));
  const path = resolve(directory, 'old.db');
  const old = new Database(path); old.pragma('foreign_keys = ON');
  migrate(drizzle(old), { migrationsFolder: migrations });
  old.prepare('INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run('old-admin', 'old-admin', 'existing-password-hash', 'admin', 1);
  old.prepare('INSERT INTO users (id,username,password_hash,role,created_at) VALUES (?,?,?,?,?)').run('old-member', 'old-member', 'existing-member-hash', 'member', 1);
  old.prepare('INSERT INTO projects (id,name,owner_id,created_at,updated_at) VALUES (?,?,?,?,?)').run('old-project', '旧项目', 'old-admin', 1, 1);
  old.prepare('INSERT INTO project_members (project_id,user_id,role) VALUES (?,?,?)').run('old-project', 'old-member', 'editor');
  old.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    const upgraded = openDatabase(path);
    try {
      const account = upgraded.sqlite.prepare('SELECT * FROM users WHERE id = ?').get('old-member') as { enabled: number; can_create_project: number; password_hash: string };
      assert.equal(account.enabled, 1); assert.equal(account.can_create_project, 1); assert.equal(account.password_hash, 'existing-member-hash');
      const project = upgraded.sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('old-project') as { owner_id: string; legacy_admin_delete: number };
      assert.equal(project.owner_id, 'old-admin'); assert.equal(project.legacy_admin_delete, 1);
      const service = permissionService(upgraded.db, Date.now);
      const member = { id: 'old-member', username: 'old-member', role: 'member' as const };
      assert.equal(service.role(member, 'old-project'), 'editor');
      assert.equal(service.can(member, 'old-project', 'page.delete'), true);
      assert.equal(service.can(member, 'old-project', 'version.publish'), false);
    } finally { upgraded.close(); }
  }
});

test('旧版数据库升级页面层级迁移后，保留原页面和完整原型内容', () => {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/db-upgrade-'));
  const migrations = resolve(directory, 'old-migrations');
  mkdirSync(resolve(migrations, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(resolve(migrations, 'meta/_journal.json'), JSON.stringify(journal));
  copyFileSync(`drizzle/${journal.entries[0].tag}.sql`, resolve(migrations, `${journal.entries[0].tag}.sql`));
  const path = resolve(directory, 'old.db');
  const old = new Database(path);
  old.pragma('foreign_keys = ON');
  migrate(drizzle(old), { migrationsFolder: migrations });
  const content = structuredClone(seedDocument);
  content.elements.find(e => e.id === 'title')!.text = '升级前的自定义内容';
  old.prepare('INSERT INTO projects (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('existing-project', '已有项目', 1, 1);
  old.prepare('INSERT INTO pages (id,project_id,name,created_at,updated_at) VALUES (?,?,?,?,?)').run('existing-page', 'existing-project', '已有页面', 1, 1);
  old.prepare('INSERT INTO documents (page_id,content,revision,updated_at) VALUES (?,?,?,?)').run('existing-page', JSON.stringify(content), 7, 1);
  old.close();
  const upgraded = openDatabase(path);
  try {
    const repository = createRepository(upgraded.db); repository.initialize();
    const restored = repository.bootstrap();
    assert.equal(restored.page.id, 'existing-page');
    assert.equal(restored.page.parentId, null);
    assert.equal(restored.revision, 7);
    assert.deepEqual(restored.document, content);
    assert.equal(repository.listProjects().length, 1);
  } finally { upgraded.close(); }
});

test('SQLite 文档在关闭重开、重复迁移与初始化后保留，包含弹窗和 Select 配置', () => {
  mkdirSync('test-results', { recursive: true });
  const path = resolve(mkdtempSync(resolve('test-results/db-persistence-')), 'test.db');
  let connection = openDatabase(path);
  let repository = createRepository(connection.db);
  repository.initialize();
  const original = repository.bootstrap();
  const changed = structuredClone(original.document);
  changed.elements.find(e => e.id === 'title')!.text = '数据库恢复后的页面';
  const role = changed.elements.find(e => e.parentId && e.kind === 'select')!;
  role.select!.options[0].label = '自定义角色';
  role.select!.defaultValues = [role.select!.options[0].id];
  const saved = repository.saveDocument(defaultPageId, 0, changed);
  assert.equal(saved.status, 'saved');
  connection.close();
  connection = openDatabase(path);
  repository = createRepository(connection.db);
  repository.initialize();
  try {
    const restored = repository.bootstrap();
    assert.equal(restored.revision, 1);
    assert.deepEqual(restored.document, changed);
    assert.equal(restored.page.id, original.page.id);
    assert.equal(repository.listProjects().length, 1);
  } finally { connection.close(); }
});

test('API 拒绝格式错误的数据和旧版本覆盖，不修改已保存文档', async () => {
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  const app = Fastify(); registerApi(app, repository);
  app.addHook('onClose', async () => connection.close());
  try {
    const bootstrap = await app.inject('/api/bootstrap');
    const initial = bootstrap.json();
    assert.equal(initial.revision, 0);
    assert.equal(initial.capabilities.persistence, true);
    const changed = structuredClone(initial.document);
    changed.elements.find((e: { id: string }) => e.id === 'title').text = '窗口一的内容';
    const saved = await app.inject({ method: 'PUT', url: `/api/pages/${defaultPageId}/document`, payload: { revision: 0, document: changed } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().revision, 1);
    const conflict = await app.inject({ method: 'PUT', url: `/api/pages/${defaultPageId}/document`, payload: { revision: 0, document: initial.document } });
    assert.equal(conflict.statusCode, 409);
    const invalid = structuredClone(changed); invalid.elements[0].width = 'bad';
    const rejected = await app.inject({ method: 'PUT', url: `/api/pages/${defaultPageId}/document`, payload: { revision: 1, document: invalid } });
    assert.equal(rejected.statusCode, 400);
    const duplicate = structuredClone(changed); duplicate.elements.push(duplicate.elements[0]);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/pages/${defaultPageId}/document`, payload: { revision: 1, document: duplicate } })).statusCode, 400);
    const read = await app.inject(`/api/pages/${defaultPageId}/document`);
    assert.equal(read.json().revision, 1);
    assert.deepEqual(read.json().document, changed);
    assert.equal((await app.inject('/api/pages/missing/document')).statusCode, 404);
  } finally { await app.close(); }
});

test('保存时元信息更新失败会回滚整个事务，文档与版本不会部分写入', () => {
  const connection = openDatabase(':memory:');
  const repository = createRepository(connection.db); repository.initialize();
  try {
    const initial = repository.bootstrap();
    connection.sqlite.exec("CREATE TRIGGER fail_page_update BEFORE UPDATE ON pages BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
    const changed = structuredClone(initial.document); changed.background = '#000000';
    assert.throws(() => repository.saveDocument(defaultPageId, 0, changed), /test rollback/);
    assert.deepEqual(repository.readDocument(defaultPageId), { document: initial.document, revision: 0, updatedAt: initial.updatedAt });
  } finally { connection.close(); }
});
