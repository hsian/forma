import { openPreview } from './preview-helpers.mjs';
// Set PLAYWRIGHT_MODULE_ROOT to a directory containing Playwright's package.json
// when using a shared browser runtime instead of a local Playwright installation.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('请使用 npm run test:browser，避免修改工作数据库');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
let page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const editorPage = page;
async function leavePreview() { await page.close(); page = editorPage; await page.bringToFront(); }
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.TEST_URL);
  await page.getByText('本地服务已连接', { exact: true }).waitFor();
  await page.locator('.node').first().waitFor();
  const initialCount = await page.locator('.node').count();
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });
  await page.getByRole('button', { name: '元素', exact: true }).click();

  await page.getByRole('button', { name: '矩形', exact: true }).click();
  assert.equal(await page.locator('.node').count(), initialCount + 1);
  const shapeId = await page.locator('.node-selected').getAttribute('data-id');
  const shape = page.locator(`[data-id="${shapeId}"]`);
  await page.getByRole('spinbutton', { name: 'W', exact: true }).fill('260');
  await page.getByRole('spinbutton', { name: 'W', exact: true }).press('Tab');
  assert.equal(await shape.evaluate(el => el.style.width), '260px');
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click();
  assert.equal(await shape.evaluate(el => el.style.width), '200px');
  await page.getByRole('button', { name: '重做 Ctrl+Shift+Z', exact: true }).click();
  assert.equal(await shape.evaluate(el => el.style.width), '260px');

  await shape.click({ position: { x: 20, y: 20 } });
  const bounds = await shape.boundingBox();
  const before = await shape.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 35, { steps: 10 });
  await page.mouse.up();
  const after = await shape.evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }));
  assert.ok(after.x > before.x && after.y > before.y, 'drag must update document coordinates');
  const resizeHandle = await page.locator('.moveable-control.moveable-se').boundingBox();
  const widthBeforeResize = await shape.evaluate(el => parseFloat(el.style.width));
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + resizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x + 35, resizeHandle.y + 25, { steps: 8 });
  await page.mouse.up();
  assert.ok(await shape.evaluate(el => parseFloat(el.style.width)) > widthBeforeResize, 'resize handle must persist new dimensions');

  await page.getByRole('button', { name: '复制选中元素 Ctrl+D', exact: true }).click();
  assert.equal(await page.locator('.node').count(), initialCount + 2);
  await page.getByRole('button', { name: '删除 Delete', exact: true }).click();
  assert.equal(await page.locator('.node').count(), initialCount + 1);
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click();
  assert.equal(await page.locator('.node').count(), initialCount + 2);

  await page.locator('.node[data-id="query"]').click();
  await page.getByRole('button', { name: '交互', exact: true }).click();
  await page.getByRole('textbox', { name: '交互内容', exact: true }).fill('已完成测试查询');
  page = await openPreview(editorPage, errors);
  await page.getByRole('textbox', { name: '姓名搜索', exact: true }).fill('林晓');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByText('已完成测试查询', { exact: true }).waitFor();
  await page.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByText('请输入成员姓名', { exact: true }).last().waitFor();
  await page.getByRole('textbox', { name: '成员姓名', exact: true }).fill('测试成员');
  await page.getByRole('textbox', { name: '邮箱', exact: true }).fill('test@example.com');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.getByText('提交成功（原型演示，未写入表格）', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/preview.png', fullPage: true });
  await leavePreview();
  await page.getByRole('button', { name: /图层/ }).click();
  await page.getByRole('button', { name: '隐藏页脚说明', exact: true }).click();
  assert.equal(await page.locator('.node[data-id="footer"]').count(), 0);
  await page.getByRole('button', { name: '显示页脚说明', exact: true }).click();
  assert.equal(await page.locator('.node[data-id="footer"]').count(), 1);
  await page.getByRole('button', { name: '解锁页头背景', exact: true }).click();
  assert.equal(await page.locator('.node[data-id="header-bg"]').getAttribute('data-locked'), 'false');

  await page.getByRole('button', { name: '元素', exact: true }).click();
  await page.getByRole('button', { name: '椭圆', exact: true }).click();
  const ellipseId = await page.locator('.node-selected').getAttribute('data-id');
  await page.getByRole('button', { name: /图层/ }).click();
  await page.locator('.layer-name').filter({ hasText: /^矩形$/ }).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.node-selected').count(), 2);
  await page.getByRole('button', { name: '设计', exact: true }).click();
  const groupBefore = await page.locator('.node-selected').evaluateAll(nodes => nodes.map(el => ({ id: el.dataset.id, x: parseFloat(el.style.left) })));
  await page.getByRole('button', { name: '左对齐', exact: true }).click();
  assert.equal(await shape.evaluate(el => el.style.left), await page.locator(`[data-id="${ellipseId}"]`).evaluate(el => el.style.left));
  await page.getByRole('button', { name: '撤销 Ctrl+Z', exact: true }).click();
  for (const item of groupBefore) assert.equal(await page.locator(`[data-id="${item.id}"]`).evaluate(el => parseFloat(el.style.left)), item.x);

  await page.locator('.layer-name').filter({ hasText: /^椭圆$/ }).click();
  await page.getByRole('button', { name: '交互', exact: true }).click();
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '点击执行动作', exact: true }) }).click();
  await page.getByText('切换元素显示 / 隐藏', { exact: true }).click();
  await page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '交互目标元素', exact: true }) }).click();
  await page.locator('.ant-select-dropdown:visible .rc-virtual-list-holder').last().evaluate(el => { el.scrollTop = 0; });
  await page.locator('.ant-select-item-option').filter({ hasText: '页面标题' }).click();
  page = await openPreview(editorPage, errors);
  assert.equal(await page.locator('.preview-page').getByText('用户管理', { exact: true }).count(), 1);
  // The ellipse is the last inserted preview element.
  await page.locator('.preview-page > div').last().click();
  assert.equal(await page.locator('.preview-page').getByText('用户管理', { exact: true }).count(), 0);
  await leavePreview();
  assert.deepEqual(errors, [], 'browser must not produce uncaught errors');
  console.log('PASS: add, properties, undo/redo, scaled drag/resize, duplicate/delete, interactions, form validation, layers, multi-select alignment, visibility toggle.');
} catch (error) {
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
  console.error('Browser errors:', errors);
  throw error;
} finally { await browser.close(); }


