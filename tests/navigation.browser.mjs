import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试数据库');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const base = process.env.TEST_URL; const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
try {
  const second = (await (await page.request.post(base + '/api/projects', { data: { name: '原型项目 B' } })).json());
  await page.goto(base); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(await page.locator('.rd-workbench').count(), 0);
  await page.goto(base + '/?projectId=' + second.project.id); await page.locator('.studio[data-server-state="ready"]').waitFor();
  let url = new URL(page.url()); assert.equal(url.searchParams.get('projectId'), second.project.id); assert.equal(url.searchParams.get('pageId'), second.page.id);
  await page.reload(); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(new URL(page.url()).searchParams.get('projectId'), second.project.id);
  await button('账号菜单').click(); assert.equal(await page.getByRole('menuitem', { name: '研发工作台', exact: true }).count(), 0); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: '返回首页', exact: true }).click(); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(new URL(page.url()).pathname, '/'); assert.equal(new URL(page.url()).searchParams.get('projectId'), second.project.id);
  await page.goto(base); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(new URL(page.url()).searchParams.get('projectId'), second.project.id, '主页恢复最近编辑的原型项目');
  await page.goto(base + '/workbench?projectId=' + second.project.id + '&section=story'); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(new URL(page.url()).pathname, '/'); assert.equal(new URL(page.url()).searchParams.get('projectId'), second.project.id); assert.equal(new URL(page.url()).searchParams.has('section'), false);
  await page.goto(base + '/manage?projectId=' + second.project.id + '&section=workflows'); await page.getByRole('heading', { name: '项目成员', exact: true }).waitFor(); assert.equal(await button('研发流程').count(), 0); assert.equal(await button('研发工作台').count(), 0);
  await button('角色与权限').click(); await page.getByRole('heading', { name: '角色与权限', exact: true }).waitFor(); assert.equal(await page.getByText('研发协作', { exact: true }).count(), 0);
  await button('返回原型设计').click(); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(new URL(page.url()).searchParams.get('projectId'), second.project.id);
  assert.equal((await page.request.get(base + '/api/projects/' + second.project.id + '/rd/items')).status(), 404);
  await page.screenshot({ path: 'test-results/home-prototype.png', fullPage: true, animations: 'disabled' });
  const guest = await browser.newPage(); guest.on('pageerror', error => errors.push(error.message)); await guest.goto(base); await guest.getByRole('heading', { name: '登录 Forma', exact: true }).waitFor();
  await guest.getByRole('textbox', { name: '用户名', exact: true }).fill('qa-admin'); await guest.getByLabel('密码', { exact: true }).fill('qa-password-123'); await guest.getByRole('button', { name: '登录', exact: true }).click(); await guest.locator('.studio[data-server-state="ready"]').waitFor();
  assert.equal((await page.request.get(base + '/api/bootstrap?projectId=missing-project&pageId=default-page')).status(), 404);
  assert.deepEqual(errors, []); console.log('PASS: 首页和登录直接进入原型、旧工作台地址兼容、项目与页面恢复、管理中心保留且研发入口和接口移除。');
} catch (error) { await page.screenshot({ path: 'test-results/navigation-failure.png', fullPage: true }); throw error; }
finally { await browser.close(); }
