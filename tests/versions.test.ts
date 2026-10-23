import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db';
import { createRepository } from '../server/db/repository';
import { makeElement } from '../shared/model';
import { registerAuth } from '../server/auth';
import { registerApi } from '../server/api';

test('固定项目版本保存完整页面树，页面去重，草稿修改删除和重命名不改变历史，新草稿独立', () => {
  const c = openDatabase(':memory:'), r = createRepository(c.db); r.initialize();
  try {
    const child = r.createPage('default-project', '子页面', 'default-page');
    const stamp = () => r.draftVersionManifest('default-project').stamp;
    const first = r.createVersion('default-project', 'V1', '已确认', '管理员', stamp());
    assert.equal(first.newPages, 2);
    const second = r.createVersion('default-project', 'V2', '', '管理员', stamp());
    assert.equal(second.newPages, 0); assert.equal(second.reusedPages, 2); assert.equal(second.newBytes, 0);
    const stale = stamp();
    c.sqlite.prepare("insert into ai_messages (id,page_id,role,content,status,provider,created_at) values ('running-test','default-page','assistant','','running','',0)").run();
    assert.throws(() => r.createVersion('default-project', '生成中', '', '管理员', stale), /AI 正在生成/);
    c.sqlite.prepare("delete from ai_messages where id='running-test'").run();
    const before = r.readDocument('default-page')!;
    const changed = structuredClone(before.document); changed.elements.find(e => e.id === 'title')!.text = '新迭代';
    r.saveDocument('default-page', before.revision, changed);
    assert.throws(() => r.createVersion('default-project', 'V3', '', '管理员', stale), /项目已更新/);
    const third = r.createVersion('default-project', 'V3', '', '管理员', stamp()); assert.equal(third.newPages, 1);
    r.deletePage(child.id); r.updatePage('default-page', { name: '新页名' }); r.renameProject('default-project', '新项目名');
    const snapshot = r.readVersion('default-project', first.version.id);
    assert.equal(snapshot.pages.length, 2); assert.equal(snapshot.pages.find(p => p.id === child.id)!.parentId, 'default-page');
    assert.equal(snapshot.pages.find(p => p.id === 'default-page')!.name, '用户管理'); assert.notEqual(snapshot.project.name, '新项目名');
    assert.equal(r.readVersionDocument('default-project', first.version.id, 'default-page').document.elements.find(e => e.id === 'title')!.text, '用户管理');
    const copy = r.copyVersion('default-project', first.version.id);
    assert.equal(r.listPages(copy.project.id).length, 2); assert.notEqual(copy.page.id, 'default-page');
    r.deleteVersion('default-project', first.version.id);
    assert.equal(r.readVersionDocument('default-project', second.version.id, 'default-page').document.elements.find(e => e.id === 'title')!.text, '用户管理');
    r.deleteVersion('default-project', second.version.id); r.deleteVersion('default-project', third.version.id);
    assert.equal(c.sqlite.prepare<[], { n: number }>('select count(*) n from page_blobs').get()!.n, 0);
    assert.equal(r.readDocument(copy.page.id)!.document.elements.find(e => e.id === 'title')!.text, '用户管理');
  } finally { c.close(); }
});

test('内嵌图片跨页面和版本按内容去重，固定资源可读取，新草稿不依赖旧版本，非法外部图片整轮回滚', () => {
  const c = openDatabase(':memory:'), r = createRepository(c.db); r.initialize();
  try {
    const doc = r.readDocument('default-page')!.document;
    const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    doc.elements.push({ ...makeElement('image'), component: { src } }); r.saveDocument('default-page', 0, doc);
    const duplicate = r.duplicatePage('default-page');
    const create = (name: string) => r.createVersion('default-project', name, '', 'admin', r.draftVersionManifest('default-project').stamp);
    const a = create('A'), b = create('B'); assert.equal(a.newAssets, 1); assert.equal(b.newAssets, 0);
    assert.equal(c.sqlite.prepare<[], { n: number }>('select count(*) n from version_asset_blobs').get()!.n, 1);
    const frozen = r.readVersionDocument('default-project', a.version.id, duplicate.id).document;
    const url = frozen.elements.at(-1)!.component!.src as string;
    assert.match(url, /\/versions\//); assert.match(Buffer.from(r.readVersionAsset('default-project', a.version.id, url.split('/').at(-1)!).data, 'base64').toString(), /<svg/);
    const copy = r.copyVersion('default-project', a.version.id);
    r.deleteVersion('default-project', a.version.id); assert.equal(c.sqlite.prepare<[], { n: number }>('select count(*) n from version_asset_blobs').get()!.n, 1);
    r.deleteVersion('default-project', b.version.id); assert.equal(c.sqlite.prepare<[], { n: number }>('select count(*) n from version_asset_blobs').get()!.n, 0);
    assert.match(String(r.readDocument(copy.page.id)!.document.elements.at(-1)!.component!.src), /^data:image/);
    const latest = r.readDocument('default-page')!; latest.document.elements.at(-1)!.component!.src = 'https://example.test/mutable.png'; r.saveDocument('default-page', latest.revision, latest.document);
    assert.throws(() => create('C'), /外部或临时图片/); assert.equal(r.listVersions('default-project').length, 0);
    assert.equal(c.sqlite.prepare<[], { n: number }>('select count(*) n from page_blobs').get()!.n, 0);
  } finally { c.close(); }
});

test('版本接口鉴权、管理员确认、编辑锁保护、跨项目隔离、旧页面删除后仍可读取，复制项目自动授权', async () => {
  const c = openDatabase(':memory:'), r = createRepository(c.db); r.initialize();
  const app = Fastify(), auth = registerAuth(app, c.db); registerApi(app, r, auth);
  const cookie = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0];
  const setup = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username: 'admin', password: 'password-123' } });
  const admin = cookie(setup), client = randomUUID();
  const request = (method: 'GET' | 'POST' | 'DELETE' | 'PUT', url: string, session = admin, payload?: object, window = client) => app.inject({ method, url, headers: { cookie: session, 'x-forma-client-id': window }, ...(payload ? { payload } : {}) });
  const root = '/api/projects/default-project/versions';
  try {
    assert.equal((await app.inject(root)).statusCode, 401);
    const member = (await request('POST', '/api/admin/users', admin, { username: 'reader', password: 'password-123' })).json().user;
    const reader = cookie(await request('POST', '/api/auth/login', '', { username: 'reader', password: 'password-123' }));
    await request('PUT', `/api/projects/default-project/members/${member.id}`, admin, { role: 'viewer' });
    const stamp = (await request('GET', root + '/draft')).json().stamp;
    assert.equal((await request('POST', root, reader, { name: 'x', stamp })).statusCode, 403);
    await request('POST', '/api/pages/default-page/lease', admin, undefined, randomUUID());
    assert.equal((await request('POST', root, admin, { name: 'V1', stamp })).statusCode, 423);
    // Lease state is not document content; release it directly in this isolated fixture.
    c.sqlite.prepare('delete from page_leases').run();
    const created = await request('POST', root, admin, { name: 'V1', stamp }); assert.equal(created.statusCode, 200, created.body);
    const id = created.json().version.id;
    assert.equal((await request('POST', root, admin, { name: 'V1', stamp })).statusCode, 409);
    assert.equal((await request('GET', `${root}/${id}`, reader)).statusCode, 200);
    assert.equal((await request('DELETE', `${root}/${id}`, reader)).statusCode, 403);
    const other = r.createProject('其他项目');
    assert.equal((await request('GET', `/api/projects/${other.project.id}/versions/${id}`)).statusCode, 404);
    const copy = await request('POST', `${root}/${id}/copy`); assert.equal(copy.statusCode, 200, copy.body);
    assert.equal((await request('GET', `/api/bootstrap?pageId=${copy.json().page.id}`)).json().projectRole, 'admin');
    r.createPage('default-project', '保留页面'); r.deletePage('default-page');
    assert.equal((await request('GET', `${root}/${id}/pages/default-page`, reader)).statusCode, 200);
  } finally { await app.close(); c.close(); }
});
