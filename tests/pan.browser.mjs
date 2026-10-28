import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const board = () => page.locator('.artboard');
const bounds = () => board().boundingBox();
async function drag(x, y, dx, dy, mouseButton = 'left') {
  await page.mouse.move(x, y); await page.mouse.down({ button: mouseButton });
  await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up({ button: mouseButton });
}
function moved(before, after, dx, dy) {
  assert.ok(Math.abs(after.x - before.x - dx) < 2, `水平应移动 ${dx}，实际 ${after.x - before.x}`);
  assert.ok(Math.abs(after.y - before.y - dy) < 2, `垂直应移动 ${dy}，实际 ${after.y - before.y}`);
}
try {
  await page.goto(`${process.env.TEST_URL}/design`);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await button('适应画布').click();
  const original = await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/document`)).json();
  const view = await page.locator('.viewport').boundingBox();
  const origin = await bounds();
  await button('平移工具（按住空格）').click();
  await drag(view.x + 28, view.y + 28, 100, 60);
  moved(origin, await bounds(), 100, 60);
  const first = await bounds();
  await drag(view.x + 28, view.y + 28, -90, -50);
  moved(first, await bounds(), -90, -50);
  // 从元素上开始平移，也不能拖动或选中元素。
  const query = page.locator('.node[data-id="query"]');
  const node = await query.boundingBox(); const beforeNode = await bounds();
  await drag(node.x + node.width / 2, node.y + node.height / 2, 45, 30);
  moved(beforeNode, await bounds(), 45, 30);
  assert.equal(await page.locator('.node-selected').count(), 0);
  await page.keyboard.press('v');
  await page.keyboard.down('Space');
  const beforeSpace = await bounds(); await drag(view.x + 28, view.y + 28, -55, 35);
  moved(beforeSpace, await bounds(), -55, 35);
  await page.keyboard.up('Space');
  assert.equal(await page.locator('.viewport.panning').count(), 0);
  const beforeMiddle = await bounds();
  await drag(view.x + 28, view.y + 28, 30, -25, 'middle'); moved(beforeMiddle, await bounds(), 30, -25);
  assert.equal(await page.locator('.viewport.panning').count(), 0);
  await page.mouse.move(view.x + 30, view.y + 30);
  const beforeWheel = await bounds();
  await page.keyboard.down('Shift'); await page.mouse.wheel(40, 60); await page.keyboard.up('Shift');
  await page.waitForFunction(expected => Math.abs(document.querySelector('.artboard').getBoundingClientRect().y - expected) < 2, beforeWheel.y - 60);
  moved(beforeWheel, await bounds(), -40, -60);
  await button('适应画布').click(); moved(origin, await bounds(), 0, 0);
  const anchor = { x: view.x + view.width / 2 + 40, y: view.y + view.height / 2 };
  const beforeZoom = await bounds();
  await page.mouse.move(anchor.x, anchor.y); await page.mouse.wheel(0, -300);
  await page.waitForFunction(width => document.querySelector('.artboard').getBoundingClientRect().width > width, beforeZoom.width);
  const afterZoom = await bounds();
  const ratio = afterZoom.width / beforeZoom.width;
  assert.ok(ratio > 1 && ratio <= 1.05 + 1e-6, '直接滚轮缩放，单次最多放大 5%');
  assert.ok(Math.abs((anchor.x - beforeZoom.x) - (anchor.x - afterZoom.x) / ratio) < 2, '缩放时保持鼠标下的内容位置');
  assert.ok(Math.abs((anchor.y - beforeZoom.y) - (anchor.y - afterZoom.y) / ratio) < 2, '缩放时保持鼠标下的内容高度');
  await button('适应画布').click(); moved(origin, await bounds(), 0, 0);
  // 平移后的选框和元素拖动仍然对应文档坐标。
  await button('平移工具（按住空格）').click(); await drag(view.x + 28, view.y + 28, 25, 20);
  await page.keyboard.press('v'); await query.click();
  assert.equal((await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/lease`)).json()).lease.expiresAt, undefined, '平移、缩放和选中元素不占用编辑权');
  const box = await query.boundingBox(); const documentX = await query.evaluate(el => parseFloat(el.style.left));
  const scale = (await board().evaluate(el => el.getBoundingClientRect().width)) / original.document.width;
  await drag(box.x + box.width / 2, box.y + box.height / 2, 36, 24);
  const newX = await query.evaluate(el => parseFloat(el.style.left));
  assert.ok(Math.abs(newX - documentX - 36 / scale) < 3, '平移后元素拖动应按缩放换算');
  await button('撤销 Ctrl+Z').click();
  await page.keyboard.press('Control+s'); await page.locator('[data-save-status="saved"]').waitFor();
  const saved = await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/document`)).json();
  assert.deepEqual(saved.document, original.document, '平移不写入或更改原型坐标');
  await page.screenshot({ path: 'test-results/pan.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: 无滚动范围时双向平移、元素上平移、空格/中键、滚轮、适应画布恢复、平移后元素拖动和文档隔离。');
} catch (error) {
  await page.screenshot({ path: 'test-results/pan-failure.png', fullPage: true }); throw error;
} finally { await browser.close(); }
