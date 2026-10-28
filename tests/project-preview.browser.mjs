import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { openPreview } from './preview-helpers.mjs';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const editor = await authenticatedPage(browser, { viewport: { width: 1600, height: 1000 } });
const errors = []; editor.on('pageerror', error => errors.push(error.message));
const base = process.env.TEST_URL;
let preview;
async function api(path, method = 'GET', data) {
  const response = await editor.request.fetch(`${base}${path}`, { method, ...(data ? { data } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
async function current(name) { await preview.locator('.preview-page-heading strong').filter({ hasText: name }).waitFor(); await preview.locator('.preview-page').waitFor(); }
async function choose(name) { await preview.locator('.preview-page-tree .ant-tree-title').getByText(name, { exact: true }).click(); await current(name); }
try {
  const seed = await api('/api/pages/default-page/document');
  const child = await api('/api/projects/default-project/pages', 'POST', { name: '成员详情', parentId: 'default-page' });
  const grandchild = await api('/api/projects/default-project/pages', 'POST', { name: '详情子页面', parentId: child.id });
  const sibling = await api('/api/projects/default-project/pages', 'POST', { name: '报表页' });
  const other = await api('/api/projects', 'POST', { name: '其他项目' });
  await api(`/api/projects/${other.project.id}/pages`, 'POST', { name: '不应出现在当前项目' });
  await api(`/api/pages/${child.id}/document`, 'PUT', { revision: 0, document: seed.document });
  await editor.addInitScript(id => localStorage.setItem('forma:last-page', id), child.id);
  await editor.goto(`${base}/design`); await editor.locator('.studio[data-server-state="ready"]').waitFor();
  await editor.locator('.current-page-name').filter({ hasText: /^成员详情$/ }).waitFor();
  await editor.locator('.node[data-id="title"]').click();
  await editor.getByRole('textbox', { name: '文字内容', exact: true }).fill('立即预览应显示最新内容');
  preview = await openPreview(editor, errors);
  const writes = []; preview.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method()); });
  await current('成员详情');
  assert.equal(new URL(preview.url()).searchParams.get('projectId'), 'default-project');
  assert.equal(new URL(preview.url()).searchParams.get('pageId'), child.id);
  assert.equal(await preview.locator('.preview-page').getByText('立即预览应显示最新内容', { exact: true }).count(), 1);
  assert.ok((await editor.locator('.current-page-name').innerText()).includes('成员详情'));
  assert.equal(await editor.locator('.node-selected[data-id="title"]').count(), 1);
  assert.equal(await preview.locator('.preview-page-tree .ant-tree-title').getByText('不应出现在当前项目', { exact: true }).count(), 0);
  assert.equal(await preview.locator('.preview-page-tree .ant-tree-node-selected').innerText(), '成员详情');
  const saved = await api(`/api/pages/${child.id}/document`);
  await preview.getByRole('textbox', { name: '姓名搜索', exact: true }).fill('临时输入');
  const mainWidth = await preview.locator('.preview-main').evaluate(el => el.getBoundingClientRect().width);
  await preview.getByRole('button', { name: '隐藏侧边栏', exact: true }).click();
  assert.equal(await preview.locator('.preview-sidebar').isVisible(), false);
  assert.ok(await preview.locator('.preview-main').evaluate(el => el.getBoundingClientRect().width) > mainWidth);
  assert.equal(await preview.getByRole('textbox', { name: '姓名搜索', exact: true }).inputValue(), '临时输入');
  await preview.getByRole('button', { name: '显示侧边栏', exact: true }).click();
  assert.equal(await preview.locator('.preview-sidebar').isVisible(), true);
  const aligned = await preview.locator('.preview-page-tree .ant-tree-node-content-wrapper').evaluateAll(nodes => nodes.every(node => {
    const icon = node.querySelector('.ant-tree-iconEle svg')?.getBoundingClientRect();
    const label = node.querySelector('.ant-tree-title')?.getBoundingClientRect();
    return icon && label && Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2) < 1;
  }));
  assert.equal(aligned, true, '树图标和标题应垂直居中');
  await preview.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  await preview.getByRole('dialog').waitFor();
  await preview.keyboard.press('Escape');
  await preview.getByRole('dialog').waitFor({ state: 'hidden' });
  await choose('报表页');
  assert.equal(await preview.getByRole('dialog').count(), 0);
  await choose('成员详情');
  assert.equal(await preview.getByRole('textbox', { name: '姓名搜索', exact: true }).inputValue(), '');
  await choose('详情子页面');
  assert.equal(new URL(preview.url()).searchParams.get('pageId'), grandchild.id);
  await preview.reload(); await current('详情子页面');
  assert.equal(await preview.locator('.preview-page-tree .ant-tree-node-selected').innerText(), '详情子页面');
  await preview.goBack(); await current('成员详情');
  await preview.goForward(); await current('详情子页面');
  assert.equal(await editor.evaluate(() => localStorage.getItem('forma:last-page')), child.id, '预览切页不改变编辑器最近页面');
  assert.deepEqual(await api(`/api/pages/${child.id}/document`), saved);
  assert.deepEqual(writes, []);
  await choose('成员详情');
  await preview.screenshot({ path: 'test-results/project-preview.png', fullPage: true });
  // 非本项目的 pageId 不允许渲染另一项目的页面。
  await preview.goto(`${base}/preview?projectId=default-project&pageId=${other.page.id}`);
  await current('用户管理');
  assert.equal(new URL(preview.url()).searchParams.get('pageId'), 'default-page');
  await preview.goto(`${base}/preview?projectId=missing&pageId=default-page`);
  await preview.getByText('项目不存在或已被删除', { exact: true }).waitFor();
  await preview.getByRole('button', { name: '返回编辑', exact: true }).click();
  await editor.bringToFront();
  assert.equal(await editor.locator('.node-selected[data-id="title"]').count(), 1);
  // 保存失败时关闭准备窗口，保留编辑器内容，不打开旧版本预览。
  await editor.route(`**/api/pages/${child.id}/document`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '测试保存失败' }) }) : route.continue());
  await editor.getByRole('textbox', { name: '文字内容', exact: true }).fill('保存失败保留当前内容');
  const opened = editor.waitForEvent('popup');
  await editor.getByRole('button', { name: '预览原型', exact: true }).click();
  const failed = await opened;
  if (!failed.isClosed()) await failed.waitForEvent('close');
  await editor.getByText('当前修改尚未保存，请先处理保存失败或冲突后再预览', { exact: true }).waitFor();
  assert.equal(await editor.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '保存失败保留当前内容');
  assert.deepEqual(errors, []);
  console.log('PASS: 新标签项目预览、当前页默认、页面/子页面树、保存后预览、刷新/前进后退、项目隔离、运行状态不回写、保存失败保护。');
} catch (error) {
  if (preview && !preview.isClosed()) await preview.screenshot({ path: 'test-results/project-preview-failure.png', fullPage: true });
  console.error(errors); throw error;
} finally { await browser.close(); }
