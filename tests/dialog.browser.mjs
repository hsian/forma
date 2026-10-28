import { authenticatedPage } from './browser-auth.mjs';
import { openPreview } from './preview-helpers.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('请使用 npm run test:browser，避免修改工作数据库');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const editorPage = page;
let dialog;
async function leavePreview() { await page.close(); page = editorPage; await page.bringToFront(); }
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const spin = name => page.getByRole('spinbutton', { name, exact: true });
async function changeNumber(name, value) { await spin(name).fill(String(value)); await spin(name).press('Tab'); }
async function returnToPage() { await page.locator('.dialog-edit-banner').getByRole('button', { name: '返回页面', exact: true }).click(); }
await mkdir('test-results', { recursive: true });
try {
  await page.goto(`${process.env.TEST_URL}/design`);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await page.locator('.node[data-id="add"]').click();
  await button('交互').click();
  await button('编辑目标弹窗').click();
  await page.getByText('正在编辑弹窗 · 新增成员', { exact: true }).waitFor();
  assert.equal(await page.locator('.artboard .node').count(), 8);
  assert.equal(await page.locator('.artboard .node[data-id="add"]').count(), 0);
  await page.getByRole('textbox', { name: '弹窗标题', exact: true }).fill('新增团队成员');
  await changeNumber('画布宽度', 1200);
  await changeNumber('画布高度', 900);
  assert.equal(await page.locator('.dialog-composition').evaluate(el => el.style.width), '1328px');
  assert.equal(await page.locator('.dialog-composition').evaluate(el => el.style.height), '1100px');
  await changeNumber('画布宽度', 520);
  await changeNumber('画布高度', 430);
  await page.locator('.node').filter({ hasText: '成员姓名 *' }).click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('成员昵称 *');

  await button('文本').click();
  const noteId = await page.locator('.node-selected').getAttribute('data-id');
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('团队成员说明');
  await changeNumber('X', 0);
  await changeNumber('Y', 300);
  await changeNumber('字号', 14);
  const nameNode = page.locator('.node').filter({ has: page.locator('input[aria-label="成员姓名"]') });
  await nameNode.click();
  const before = await nameNode.evaluate(el => parseFloat(el.style.left));
  const bounds = await nameNode.boundingBox();
  await page.mouse.move(bounds.x + 80, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 110, bounds.y + 26, { steps: 8 });
  await page.mouse.up();
  assert.ok(await nameNode.evaluate(el => parseFloat(el.style.left)) > before);
  await button('撤销 Ctrl+Z').click();
  assert.equal(await nameNode.evaluate(el => parseFloat(el.style.left)), before);
  await page.screenshot({ path: 'test-results/dialog-editor.png', fullPage: true });
  await returnToPage();
  assert.equal(await page.locator(`.node[data-id="${noteId}"]`).count(), 0, 'dialog children must not leak onto page');
  assert.equal(await page.locator('.artboard').evaluate(el => el.style.width), '1040px', 'dialog width must not resize page');

  page = await openPreview(editorPage, errors); dialog = page.getByRole('dialog');
  await button('+ 新增成员').click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('新增团队成员', { exact: true }).waitFor();
  await dialog.getByText('成员昵称 *', { exact: true }).waitFor();
  await dialog.getByText('团队成员说明', { exact: true }).waitFor();
  assert.equal(await page.locator('.runtime-dialog-canvas').evaluate(el => el.style.width), '520px');
  await button('确定').click();
  await dialog.getByText('请输入成员姓名', { exact: true }).waitFor();
  await dialog.getByRole('textbox', { name: '成员姓名', exact: true }).fill('王小明');
  await dialog.getByRole('textbox', { name: '邮箱', exact: true }).fill('invalid');
  await button('确定').click();
  await dialog.getByText('请输入有效邮箱', { exact: true }).waitFor();
  await dialog.getByRole('textbox', { name: '邮箱', exact: true }).fill('member@example.com');
  await button('确定').click();
  await page.getByText('提交成功（原型演示，未写入表格）', { exact: true }).waitFor();
  await dialog.waitFor({ state: 'hidden' });
  await button('+ 新增成员').click();
  await button('取消').click();
  await dialog.waitFor({ state: 'hidden' });
  await leavePreview();

  // A second trigger creates an independent dialog and previews its own elements.
  await page.locator('.node[data-id="query"]').click();
  await button('交互').click();
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '点击执行动作', exact: true }) }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: /^打开弹窗$/ }).click();
  await button('编辑目标弹窗').click();
  assert.equal(await page.locator('.artboard .node').count(), 2);
  await button('文本').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('查询专用弹窗');
  page = await openPreview(editorPage, errors); dialog = page.getByRole('dialog');
  await dialog.getByText('查询专用弹窗', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('团队成员说明', { exact: true }).count(), 0);
  await button('取消').click();
  await leavePreview();
  await returnToPage();
  page = await openPreview(editorPage, errors); dialog = page.getByRole('dialog');
  await button('查询').click();
  await dialog.getByText('查询专用弹窗', { exact: true }).waitFor();
  await button('取消').click();
  await button('+ 新增成员').click();
  await dialog.getByText('团队成员说明', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="dialog"]');
    return el && Math.abs(el.getBoundingClientRect().width - parseFloat(getComputedStyle(el).width)) < 1;
  });
  await dialog.screenshot({ path: 'test-results/dialog-preview.png' });
  await button('取消').click();
  await leavePreview();

  // Undoing creation removes both the container and children, and exits its edit context.
  await button('图层').click();
  const count = await page.locator('.dialog-library .dialog-edit').count();
  await button('新建弹窗').click();
  assert.equal(await page.locator('.dialog-library .dialog-edit').count(), count + 1);
  await button('撤销 Ctrl+Z').click();
  assert.equal(await page.locator('.dialog-library .dialog-edit').count(), count);
  await page.locator('.dialog-edit-banner').waitFor({ state: 'hidden' });
  // Dialogs belong to layers; deleting the active one is undoable and persists.
  await button('元素').click();
  assert.equal(await page.locator('.dialog-library').count(), 0);
  await button('图层').click();
  await button('编辑弹窗 新增团队成员').click();
  await button('删除弹窗 新增团队成员').click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByText('正在编辑弹窗 · 新增团队成员', { exact: true }).waitFor();
  await button('删除弹窗 新增团队成员').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除弹窗', exact: true }).click();
  await page.locator('.dialog-edit-banner').waitFor({ state: 'hidden' });
  assert.equal(await button('编辑弹窗 新增团队成员').count(), 0);
  await button('撤销 Ctrl+Z').click();
  await button('编辑弹窗 新增团队成员').waitFor();
  await button('重做 Ctrl+Shift+Z').click();
  await page.locator('.save-state[data-save-status="saved"]').waitFor();
  await page.waitForFunction(async () => {
    const { document: doc } = await (await fetch('/api/pages/default-page/document')).json();
    return !doc.dialogs.some(d => d.title === '新增团队成员') && doc.elements.find(e => e.id === 'add').action === 'none';
  });
  await page.reload();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await button('图层').click();
  assert.equal(await button('编辑弹窗 新增团队成员').count(), 0);
  await page.screenshot({ path: 'test-results/dialog-layers.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: editable modal content, isolated layers/dimensions, drag/undo, runtime content, required/email validation, cancel/submit, independent targets, undo container creation.');
} catch (error) {
  await page.screenshot({ path: 'test-results/dialog-failure.png', fullPage: true });
  console.error(errors);
  throw error;
} finally { await browser.close(); }

