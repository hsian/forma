import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const base = process.env.TEST_URL; const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on('pageerror', error => errors.push(error.message));
const button = (p, name) => p.getByRole('button', { name, exact: true });
async function login(username) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const p = await context.newPage(); p.on('pageerror', error => errors.push(error.message));
  await p.goto(base); await p.getByRole('heading', { name: '登录工作台', exact: true }).waitFor();
  await p.getByRole('textbox', { name: '用户名', exact: true }).fill(username); await p.getByLabel('密码', { exact: true }).fill('password-123'); await button(p, '登录').click();
  await p.locator('.studio[data-server-state="ready"]').waitFor(); return p;
}
async function choose(p, label, option) { await p.locator('.ant-select').filter({ has: p.getByRole('combobox', { name: label, exact: true }) }).click(); await p.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last().locator('.ant-select-item-option').filter({ hasText: new RegExp('^' + option + '$') }).click(); }
try {
  assert.equal((await page.request.get(`${base}/api/bootstrap`)).status(), 401);
  await page.goto(base); await page.getByRole('heading', { name: '创建管理员账号', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/auth-setup.png', fullPage: true });
  await page.getByRole('textbox', { name: '用户名', exact: true }).fill('admin'); await page.getByLabel('密码', { exact: true }).fill('password-123'); await page.getByLabel('确认密码', { exact: true }).fill('password-123');
  await button(page, '创建管理员并进入').click(); await page.locator('.studio[data-server-state="ready"]').waitFor();
  assert.equal(await page.locator('.collaboration-bar').count(), 0);
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/lease`)).json()).lease.expiresAt, undefined);
  assert.equal((await (await page.request.get(`${base}/api/auth/status`)).json()).user.role, 'admin');
  await button(page, '账号菜单').click(); await page.getByRole('menuitem', { name: '账号与项目权限', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByText('创建成员账号', { exact: true }).waitFor();
  for (const [username, access] of [['editor', '可编辑'], ['reader', '只读']]) {
    await dialog.getByRole('textbox', { name: '新成员用户名', exact: true }).fill(username); await dialog.getByLabel('新成员密码', { exact: true }).fill('password-123');
    await button(page, '创建成员').click(); await page.getByRole('combobox', { name: `${username} 项目权限`, exact: true }).waitFor();
    await choose(page, `${username} 项目权限`, access); await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
  }
  await page.screenshot({ path: 'test-results/auth-members.png', fullPage: true });
  await button(page, '完成').click(); await dialog.waitFor({ state: 'hidden' });
  const editor = await login('editor');
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/lease`)).json()).lease.expiresAt, undefined, '打开两个窗口都不占用页面');
  await page.locator('.node[data-id="title"]').click();
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/lease`)).json()).lease.expiresAt, undefined, '选中元素也不占用页面');
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('多人协作标题');
  await page.locator('[data-save-status="saved"]').waitFor();
  const document = (await (await page.request.get(`${base}/api/pages/default-page/document`)).json());
  assert.equal((await editor.request.put(`${base}/api/pages/default-page/document`, { data: { revision: document.revision, document: document.document }, headers: { 'x-forma-client-id': randomUUID() } })).status(), 423);
  // A race after an initially free view must roll back the unowned edit.
  await editor.locator('.node[data-id="title"]').click(); await editor.getByRole('textbox', { name: '文字内容', exact: true }).fill('不能覆盖管理员');
  await editor.locator('.editing-hint').filter({ hasText: 'admin 正在编辑' }).waitFor();
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/document`)).json()).document.elements.find(e=>e.id==='title').text, '多人协作标题');
  await page.clock.install(); await page.clock.fastForward(65000);
  await page.waitForFunction(async () => !(await (await fetch('/api/pages/default-page/lease')).json()).lease.expiresAt);
  await editor.clock.install(); await editor.clock.fastForward(20000);
  await editor.locator('.node[data-id="title"]').getByText('多人协作标题', { exact: true }).waitFor();
  await editor.locator('.node[data-id="title"]').click(); await editor.getByRole('textbox', { name: '文字内容', exact: true }).fill('成员编辑后的标题');
  await editor.locator('[data-save-status="saved"]').waitFor();
  // Separate pages can be edited concurrently after actual changes, not merely by opening them.
  const created = (await (await page.request.post(`${base}/api/projects/default-project/pages`, { data: { name: '并行页面' } })).json());
  await button(page, '刷新页面列表').click(); await page.locator('.page-tree-title>span').getByText('并行页面', { exact: true }).click();
  await page.locator('.current-page-name').getByText('并行页面', { exact: true }).waitFor();
  await button(page, '元素').click(); await button(page, '文本').click(); await page.locator('[data-save-status="saved"]').waitFor();
  assert.equal(await page.evaluate(async id=>(await(await fetch('/api/pages/'+id+'/lease')).json()).lease.owned,created.id),true);
  assert.equal(await editor.evaluate(async ()=>(await(await fetch('/api/pages/default-page/lease')).json()).lease.owned),true);
  const reader = await login('reader');
  assert.equal(await reader.locator('.artboard').evaluate(el=>el.inert),true);
  assert.equal(await button(reader, '开始编辑').count(), 0); assert.equal(await button(reader, '新建页面').isDisabled(), true);
  assert.equal((await reader.request.post(`${base}/api/pages/default-page/ai/turn`, { data: {} })).status(), 403);
  const previewOpen = reader.waitForEvent('popup'); await button(reader, '预览原型').click(); const preview = await previewOpen; await preview.locator('.preview-page').waitFor(); await preview.close();
  await reader.screenshot({ path: 'test-results/auth-readonly.png', fullPage: true });
  await button(editor, '账号菜单').click(); await editor.getByRole('menuitem', { name: '退出登录', exact: true }).click(); await editor.getByRole('heading', { name: '登录工作台', exact: true }).waitFor();
  await button(page, '页面').click(); await page.locator('.page-tree-title>span').getByText('用户管理', { exact: true }).click();
  await page.locator('.node[data-id="title"]').getByText('成员编辑后的标题', { exact: true }).waitFor();
  // Before the next poll, another window can finish an edit and release the page.
  // The stale window must refresh instead of saving its first optimistic mutation.
  const latestEditor = await login('editor');
  await latestEditor.locator('.node[data-id="title"]').click(); await latestEditor.getByRole('textbox', { name: '文字内容', exact: true }).fill('其他窗口的最新内容');
  await latestEditor.locator('[data-save-status="saved"]').waitFor();
  await button(latestEditor, '账号菜单').click(); await latestEditor.getByRole('menuitem', { name: '退出登录', exact: true }).click(); await latestEditor.getByRole('heading', { name: '登录工作台', exact: true }).waitFor();
  await page.locator('.node[data-id="title"]').click(); await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('过期内容不应覆盖');
  await page.locator('.editing-hint').filter({ hasText: '页面已有更新' }).waitFor();
  await page.locator('.node[data-id="title"]').getByText('其他窗口的最新内容', { exact: true }).waitFor();
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/document`)).json()).document.elements.find(e=>e.id==='title').text, '其他窗口的最新内容');
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/lease`)).json()).lease.expiresAt, undefined);
  await page.locator('.node[data-id="title"]').click(); await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('刷新后继续修改');
  await page.locator('[data-save-status="saved"]').waitFor();
  assert.equal((await (await page.request.get(`${base}/api/pages/default-page/document`)).json()).document.elements.find(e=>e.id==='title').text, '刷新后继续修改');
  assert.deepEqual(errors, []);
  console.log('PASS: 首位管理员初始化、成员授权、按需获取和空闲释放编辑权、同页编辑互斥、过期页面防覆盖与恢复、只读同步、不同页并行和退出释放。');
} catch (error) { await page.screenshot({ path: 'test-results/auth-failure.png', fullPage: true }); throw error; }
finally { await browser.close(); }
