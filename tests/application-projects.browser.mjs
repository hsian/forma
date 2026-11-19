import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let previewServer;
async function until(check, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(message);
}
try {
  await page.goto(`${process.env.TEST_URL}/design`);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '管理名称', exact: true }).fill('客户管理应用');
  await dialog.getByText('管理后台', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('radio').count(), 1);
  assert.equal(await dialog.getByRole('radio', { name: '管理后台', exact: true }).getAttribute('aria-checked'), 'true');
  await dialog.getByRole('img', { name: '管理后台模板预览', exact: true }).waitFor();
  assert.equal(await dialog.getByText(/移动应用|商城/).count(), 0);
  const selectedDirectory = resolve(process.env.FORMA_PROJECTS_ROOT, '业务项目');
  await mkdir(selectedDirectory, { recursive: true });
  let pickerCalls = 0;
  // 系统窗口不由网页控制；模拟返回值验证确认与取消，原生适配另有 Windows COM 检查。
  await page.route('**/api/application-directories/pick', route => {
    pickerCalls++;
    return route.fulfill({ status: 200, json: { directory: pickerCalls === 1 ? null : selectedDirectory } });
  });
  await dialog.getByRole('button', { name: '选择目录', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.application-directory-field .ant-btn-loading'));
  assert.equal(await dialog.getByRole('textbox', { name: '存放位置', exact: true }).inputValue(), process.env.FORMA_PROJECTS_ROOT);
  assert.equal(await page.getByRole('dialog').count(), 1, '不显示网页目录弹窗');
  await dialog.getByRole('button', { name: '选择目录', exact: true }).click();
  await page.waitForFunction(path => document.querySelector('#application-parent-directory')?.value === path, selectedDirectory);
  assert.equal(await dialog.getByRole('textbox', { name: '存放位置', exact: true }).inputValue(), resolve(process.env.FORMA_PROJECTS_ROOT, '业务项目'));
  await page.screenshot({ path: 'test-results/application-create.png', fullPage: true, animations: 'disabled' });
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.current-page-name')?.textContent === '首页' && !document.querySelector('.editor-layout').inert);
  const projects = (await (await page.request.get(`${process.env.TEST_URL}/api/projects`)).json()).projects;
  const project = projects.find(item => item.name === '客户管理应用');
  assert.ok(project.application.directory.startsWith(process.env.FORMA_PROJECTS_ROOT));
  assert.equal(project.application.parentDirectory, resolve(process.env.FORMA_PROJECTS_ROOT, '业务项目'));
  const pages = (await (await page.request.get(`${process.env.TEST_URL}/api/projects/${project.id}/pages`)).json()).pages;
  const initial = (await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/document`)).json()).document;
  initial.elements.find(item => item.id === 'title').text = '客户管理';
  const saved = await page.request.put(`${process.env.TEST_URL}/api/pages/${pages[0].id}/document`, { data: { revision: 0, document: initial } });
  assert.equal(saved.ok(), true, await saved.text());
  const child = (await (await page.request.post(`${process.env.TEST_URL}/api/projects/${project.id}/pages`, { data: { name: '客户详情', parentId: pages[0].id } })).json());
  const extension = resolve(project.application.directory, 'src/utils/keep.ts');
  await writeFile(extension, 'export const keep = true;\n');
  await until(async () => { const data = await (await page.request.get(`${process.env.TEST_URL}/api/projects/${project.id}/application`)).json(); return data.sync?.state === 'synced' && data.sync.sourceFiles.length === 2 && data.sync.sourceFiles.find(source => source.pageId === pages[0].id)?.revision >= 1; }, '页面源码未自动同步');
  const automatic = (await (await page.request.get(`${process.env.TEST_URL}/api/projects/${project.id}/application`)).json()).sync;
  const pageSource = resolve(project.application.directory, automatic.sourceFiles.find(source => source.pageId === pages[0].id).file);
  assert.match(await readFile(pageSource, 'utf8'), /客户管理/);
  // The fixture acquired an edit lease through the API; release it before reload creates a new browser client.
  await page.request.delete(`${process.env.TEST_URL}/api/pages/${pages[0].id}/lease`);
  await page.reload();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  // Exercise the real AI -> editor -> autosave -> source generation chain with the isolated model.
  await page.locator('.node[data-id="query"]').click();
  await page.keyboard.press('Control+Backquote');
  await page.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('把选中的按钮改成蓝色');
  await page.getByRole('button', { name: '发送 AI 修改要求', exact: true }).click();
  await until(async () => { const data = await (await page.request.get(`${process.env.TEST_URL}/api/pages/${pages[0].id}/document`)).json(); return data.document.elements.find(element => element.id === 'query').fill === '#1677ff'; }, 'AI 修改未保存');
  await until(async () => { const data = await (await page.request.get(`${process.env.TEST_URL}/api/projects/${project.id}/application`)).json(); return data.sync?.state === 'synced' && data.sync.sourceFiles.find(source => source.pageId === pages[0].id)?.revision >= 2; }, 'AI 修改未自动更新源码');
  assert.match(await readFile(pageSource, 'utf8'), /#1677ff/);
  await page.keyboard.press('Control+Backquote');
  await page.getByRole('button', { name: '项目操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '业务工程', exact: true }).click();
  await dialog.getByText('管理后台 · 1.1.0', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '同步页面到工程', exact: true }).click();
  await page.getByText('已同步 2 个页面，开发者扩展已保留', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/application-workspace.png', fullPage: true, animations: 'disabled' });
  assert.equal(await readFile(extension, 'utf8'), 'export const keep = true;\n');
  const snapshot = JSON.parse(await readFile(resolve(project.application.directory, '.forma/snapshot.json'), 'utf8'));
  assert.equal(snapshot.pages[0].document.elements.find(item => item.id === 'title').text, '客户管理');

  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  previewServer = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), project.application.directory, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  previewServer.stdout.on('data', chunk => { logs += chunk; }); previewServer.stderr.on('data', chunk => { logs += chunk; });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (previewServer.exitCode !== null) throw Error(logs);
    try { if ((await fetch(url)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  const business = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  business.on('pageerror', error => errors.push(error.message));
  await business.goto(url);
  await business.locator('[data-preview-id="title"]').getByText('客户管理', { exact: true }).waitFor();
  assert.equal(await business.getByRole('menu').count(), 0, '默认展示设计本身，不额外添加模板菜单');
  assert.equal(await business.getByRole('button', { name: '切换导航', exact: true }).count(), 0);
  assert.equal(await business.locator('.business-header,.business-brand').count(), 0);
  assert.equal(await business.locator('[data-application-layout="page"]').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(247, 248, 251)');
  const designBox = await business.locator('.preview-page').boundingBox();
  assert.equal(designBox.width, initial.width);
  assert.equal(designBox.height, initial.height);
  assert.ok(Math.abs(designBox.x - (1440 - initial.width) / 2) < 1, '画布居中，不增加模板边距');
  await business.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  await business.getByRole('dialog').getByText('新增成员', { exact: true }).waitFor();
  await business.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await business.getByRole('dialog').waitFor({ state: 'hidden' });
  await business.screenshot({ path: 'test-results/application-running.png', fullPage: true, animations: 'disabled' });
  await business.goto(`${url}/#page=${child.id}`);
  await business.waitForURL(`**/#page=${child.id}`);
  await business.reload();
  await business.waitForFunction(() => document.title.startsWith('客户详情'));
  await business.goto(`${url}/#page=${pages[0].id}`);
  await business.locator('[data-preview-id="title"]').getByText('客户管理', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.node[data-id="title"]').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('自动更新的客户管理');
  await until(async () => (await readFile(pageSource, 'utf8')).includes('自动更新的客户管理'), '编辑后页面源码未自动更新');
  try { await business.locator('[data-preview-id="title"]').getByText('自动更新的客户管理', { exact: true }).waitFor({ timeout: 12000 }); }
  catch (error) { console.error('独立工程预览日志：', logs, await business.locator('body').innerText(), errors); throw error; }
  assert.deepEqual(errors, []);
  console.log('PASS: 模板选择、工程初始化、AI 修改与编辑自动生成源码、扩展保留，以及独立应用导航、刷新、弹窗和实时更新。');
} catch (error) {
  await page.screenshot({ path: 'test-results/application-failure.png', fullPage: true });
  throw error;
} finally {
  await browser.close();
  if (previewServer?.exitCode === null) { previewServer.kill(); await new Promise(resolve => previewServer.once('exit', resolve)); }
}
