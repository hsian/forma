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


test('移除研发测试数据和归档表，保留原型、版本、账号与权限', () => {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/prototype-only-upgrade-'));
  const migrations = resolve(directory, 'old-migrations'); mkdirSync(resolve(migrations, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')); journal.entries = journal.entries.filter((entry: {idx: number}) => entry.idx < 9);
  writeFileSync(resolve(migrations, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync('drizzle/' + entry.tag + '.sql', resolve(migrations, entry.tag + '.sql'));
  const path = resolve(directory, 'old.db'), old = new Database(path); old.pragma('foreign_keys = ON'); migrate(drizzle(old), { migrationsFolder: migrations });
  const insert = (table: string, values: Record<string, string | number | null>) => old.prepare('INSERT INTO ' + table + ' (' + Object.keys(values).join(',') + ') VALUES (' + Object.keys(values).map(() => '?').join(',') + ')').run(...Object.values(values));
  for (const id of ['owner', 'product-member', 'custom-member']) insert('users', { id, username:id, password_hash:'existing-password', role:id === 'owner' ? 'admin' : 'member', created_at:1 });
  insert('projects', { id:'old-project', name:'保留原型', owner_id:'owner', created_at:1, updated_at:1 });
  insert('project_roles', { id:'custom-role', project_id:'old-project', name:'自定义设计角色', description:'保留原型编辑权限', permissions:JSON.stringify(['prototype.read','prototype.edit','rd.read','task.edit']), revision:1 });
  insert('project_members', { project_id:'old-project', user_id:'product-member', role:'viewer', custom_role_id:'product' });
  insert('project_members', { project_id:'old-project', user_id:'custom-member', role:'editor', custom_role_id:'custom-role' });
  insert('pages', { id:'old-page', project_id:'old-project', folder_id:null, parent_id:null, name:'旧原型页', position:0, created_at:1, updated_at:1 });
  const document = structuredClone(seedDocument); insert('documents', { page_id:'old-page', content:JSON.stringify(document), revision:7, updated_at:1 });
  insert('project_versions', { id:'old-version', project_id:'old-project', project_name:'保留原型', name:'已确认版本', description:'旧版', created_by:'owner', created_at:1 });
  for (const [id, parent] of [['old-story', null], ['old-task', 'old-story']]) insert('rd_items', { id, project_id:'old-project', kind:parent ? 'task':'story', number:1, key:id, title:id, description:'原需求说明', acceptance:'', status:parent ? 'open':'draft', workflow_version:1, owner_id:'owner', owner_ids:'["owner"]', tester_id:null, creator_id:'owner', parent_id:parent, iteration_id:null, priority:'p2', severity:'normal', resolution:'', found_version:'', fix_version:'', due_date:'', estimate:0, spent:0, blocked:0, blocked_reason:'', revision:1, deleted_at:null, completed_at:null, created_at:1, updated_at:1 });
  insert('rd_prototype_links', { id:'old-link', item_id:'old-story', version_id:'old-version', page_id:'old-page', annotation_id:null, version_name:'已确认版本', page_name:'旧原型页', annotation_title:'', dialog_id:null, created_at:1 });
  insert('rd_attachments', { id:'old-file', item_id:'old-task', name:'原附件.txt', bytes:3, data:'YWJj', actor:'owner', created_at:1 });
  old.close();
  const upgraded = openDatabase(path);
  try {
    const repository = createRepository(upgraded.db);
    assert.deepEqual(repository.readDocument('old-page')!.document, document); assert.equal(repository.readDocument('old-page')!.revision, 7);
    const member = upgraded.sqlite.prepare('SELECT role,custom_role_id FROM project_members WHERE user_id = ?').get('product-member') as {role:string;custom_role_id:null}; assert.deepEqual(member, {role:'viewer',custom_role_id:null});
    const service = permissionService(upgraded.db, Date.now); const user = {id:'custom-member',username:'custom-member',role:'member' as const}; assert.equal(service.can(user,'old-project','prototype.edit'),true);
    assert.deepEqual(service.access(user,'old-project')!.permissions, ['prototype.read','prototype.edit']);
    assert.deepEqual(upgraded.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'rd_*' OR name GLOB 'retired_rd_*')").all(), []);
    assert.equal((upgraded.sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get('owner') as {password_hash:string}).password_hash, 'existing-password');
    assert.equal((upgraded.sqlite.prepare('SELECT COUNT(*) AS count FROM project_versions').get() as {count:number}).count, 1);
    assert.equal(upgraded.sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.deepEqual(repository.deleteVersion('old-project','old-version'), {ok:true});
  } finally { upgraded.close(); }
  const reopened = openDatabase(path); try { assert.deepEqual(reopened.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name GLOB 'rd_*' OR name GLOB 'retired_rd_*')").all(), []); assert.equal((reopened.sqlite.prepare('SELECT COUNT(*) AS count FROM documents').get() as {count:number}).count, 1); } finally { reopened.close(); }
});


test('已完成归档的数据库也会移除全部研发测试归档表', () => {
  mkdirSync('test-results', { recursive: true });
  const directory = mkdtempSync(resolve('test-results/rd-test-data-cleanup-'));
  const migrations = resolve(directory, 'old-migrations'); mkdirSync(resolve(migrations, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')); journal.entries = journal.entries.filter((entry: {idx: number}) => entry.idx < 10);
  writeFileSync(resolve(migrations, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync('drizzle/' + entry.tag + '.sql', resolve(migrations, entry.tag + '.sql'));
  const path = resolve(directory, 'archived.db'), old = new Database(path); migrate(drizzle(old), { migrationsFolder: migrations });
  for (const table of ['items','iterations','workflows','events','prototype_links','attachments']) old.prepare('INSERT INTO retired_rd_' + table + ' (id) VALUES (?)').run('test-data');
  old.close(); const cleaned = openDatabase(path);
  try { assert.deepEqual(cleaned.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'retired_rd_*'").all(), []); } finally { cleaned.close(); }
});
