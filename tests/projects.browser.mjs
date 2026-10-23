import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('请使用 npm run test:browser，避免修改工作数据库');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.TEST_URL;
const button = name => page.getByRole('button', { name, exact: true });
const nameDialog = () => page.getByRole('dialog');
async function enterName(value) {
  await page.getByRole('textbox', { name: '管理名称', exact: true }).fill(value);
  await nameDialog().getByRole('button', { name: '确定', exact: true }).click();
  await nameDialog().waitFor({ state: 'hidden' });
}
async function current(name) {
  await page.waitForFunction(name => document.querySelector('.workspace-title strong')?.textContent === name && !document.querySelector('.editor-layout').inert, name);
}
async function pageMenu(name, action) {
  await button(`页面操作 ${name}`).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
async function openPage(name) {
  await button('页面').click();
  await page.locator('.page-tree-title>span').filter({ hasText: new RegExp(`^${name}$`) }).click();
  await current(name);
}
async function selectProject(name) {
  await button('页面').click();
  await page.locator('.project-switcher .ant-select').click();
  await page.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^${name}$`) }).click();
  await page.waitForFunction(name => document.querySelector('.project-switcher .ant-select-selection-item')?.textContent === name && !document.querySelector('.editor-layout').inert, name);
}
async function selectedId() { return page.evaluate(() => localStorage.getItem('forma:last-page')); }
async function projectPages(id) { return (await (await page.request.get(`${base}/api/projects/${id}/pages`)).json()).pages; }
try {
  await page.goto(base);
  await page.getByText('本地服务已连接', { exact: true }).waitFor();
  await page.locator('.page-tree-title>span').filter({ hasText: /^用户管理$/ }).waitFor();
  const initial = await (await page.request.get(`${base}/api/bootstrap`)).json();
  await button('新建页面').click();
  await enterName('成员详情'); await current('成员详情');
  const detailId = await selectedId();
  assert.equal(await page.locator('.node').count(), 0);
  await button('元素').click(); await button('文本').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('详情独立内容');
  // Switching immediately must flush pending edits before replacing the canvas.
  await openPage('用户管理');
  assert.equal(await page.locator('.node[data-id="title"] .text-content').innerText(), '用户管理');
  const detailDoc = (await (await page.request.get(`${base}/api/pages/${detailId}/document`)).json()).document;
  assert.equal(detailDoc.elements[0].text, '详情独立内容');
  await openPage('成员详情');
  assert.equal(await page.locator('.node .text-content').innerText(), '详情独立内容');
  await pageMenu('成员详情', '新建子页面'); await enterName('编辑成员'); await current('编辑成员');
  const childId = await selectedId();
  await pageMenu('编辑成员', '新建子页面'); await enterName('权限配置'); await current('权限配置');
  const grandchildId = await selectedId();
  let pages = await projectPages(initial.project.id);
  assert.equal(pages.find(item => item.id === childId).parentId, detailId);
  assert.equal(pages.find(item => item.id === grandchildId).parentId, childId);
  await pageMenu('编辑成员', '重命名页面'); await enterName('编辑资料'); await current('权限配置');
  await pageMenu('编辑资料', '移动页面');
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '父页面', exact: true }) }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: /^项目根目录$/ }).click();
  await nameDialog().getByRole('button', { name: '移动', exact: true }).click();
  await nameDialog().waitFor({ state: 'hidden' });
  pages = await projectPages(initial.project.id);
  assert.equal(pages.find(item => item.id === childId).parentId, null);
  assert.equal(pages.find(item => item.id === grandchildId).parentId, childId);
  await pageMenu('成员详情', '复制此页'); await current('成员详情 副本');
  assert.equal(await page.locator('.node .text-content').innerText(), '详情独立内容');
  await page.locator('.node').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('副本独立内容');
  await openPage('成员详情');
  assert.equal(await page.locator('.node .text-content').innerText(), '详情独立内容');

  await button('新建项目').click(); await enterName('业务后台'); await current('首页');
  assert.equal(await page.locator('.node').count(), 0);
  const homeId = await selectedId();
  await button('元素').click(); await button('按钮').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('另一个项目');
  await selectProject('单页原型探索'); await current('用户管理');
  assert.equal(await page.locator('.node[data-id="title"] .text-content').innerText(), '用户管理');
  await selectProject('业务后台'); await current('首页');
  assert.ok((await page.locator('.node').innerText()).includes('另一个项目'));
  await button('项目操作').click(); await page.getByRole('menuitem', { name: '重命名项目', exact: true }).click();
  await enterName('业务后台二');
  await page.reload(); await page.getByText('本地服务已连接', { exact: true }).waitFor(); await current('首页');
  assert.equal(await selectedId(), homeId);
  assert.equal(await page.locator('.project-switcher .ant-select-selection-item').innerText(), '业务后台二');
  assert.ok((await page.locator('.node').innerText()).includes('另一个项目'));
  await button('项目操作').click(); await page.getByRole('menuitem', { name: '删除项目', exact: true }).click();
  await nameDialog().getByRole('button', { name: '删除项目', exact: true }).click();
  await nameDialog().waitFor({ state: 'hidden' }); await current('用户管理');

  await pageMenu('成员详情', '新建子页面'); await enterName('待删除子页'); await current('待删除子页');
  const deletedChildId = await selectedId();
  await pageMenu('成员详情', '删除页面');
  await nameDialog().getByText('这会同时删除它的 1 个子页面及各自的原型内容。', { exact: true }).waitFor();
  await nameDialog().getByRole('button', { name: '删除页面', exact: true }).click();
  await nameDialog().waitFor({ state: 'hidden' }); await current('用户管理');
  assert.equal((await page.request.get(`${base}/api/pages/${deletedChildId}/document`)).status(), 404);
  assert.equal(await page.getByRole('button', { name: '页面操作 成员详情', exact: true }).count(), 0);
  await button('页面操作 编辑资料').waitFor();
  await page.screenshot({ path: 'test-results/projects-tree.png', fullPage: true });

  let fail = true;
  await page.route('**/api/pages/*/document', route => {
    if (route.request().method() === 'PUT' && fail) { fail = false; return route.fulfill({ status: 503, json: { message: '测试保存失败' } }); }
    return route.continue();
  });
  await page.locator('.node[data-id="title"]').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('未保存内容不能被切换丢弃');
  await page.locator('[data-save-status="error"]').waitFor();
  await page.locator('.page-tree-title>span').filter({ hasText: /^编辑资料$/ }).click();
  await page.getByText('当前页面尚未保存，请先处理保存失败或版本冲突', { exact: true }).waitFor();
  await current('用户管理');
  assert.equal(await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '未保存内容不能被切换丢弃');
  await button('重试保存').click(); await page.locator('[data-save-status="saved"]').waitFor();
  await openPage('编辑资料');
  assert.equal(await page.locator('.node').count(), 0);
  await page.setViewportSize({ width: 760, height: 1000 });
  assert.ok(await button('新建项目').isVisible());
  assert.ok(await button('新建页面').isVisible());
  assert.deepEqual(errors, []);
  console.log('PASS: project CRUD/switch, page/subpage tree, rename/move/copy/delete, isolated documents, save-before-switch, selection recovery and narrow layout.');
} catch (error) {
  await page.screenshot({ path: 'test-results/projects-failure.png', fullPage: true });
  console.error(errors);
  throw error;
} finally { await browser.close(); }
