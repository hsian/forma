import { authenticatedPage } from './browser-auth.mjs';
import { openPreview } from './preview-helpers.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await authenticatedPage(browser, { viewport: { width: 1600, height: 1000 } });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.TEST_URL });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const modelCalls = []; page.on('request', request => { if (/image-prototype|\/ai\/turn/.test(request.url())) modelCalls.push(request.url()); });
const images = () => page.locator('.artboard .node:has(.prototype-image)');
const button = name => page.getByRole('button', { name, exact: true });
const endpoint = `${process.env.TEST_URL}/api/pages/default-page/document`;
const doc = async () => (await (await page.request.get(endpoint)).json()).document;
async function canvasFocus() { await page.locator('.viewport').click({ position: { x: 20, y: 20 } }); }
async function writeImage(width, height) {
  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.fillStyle = '#faca59'; context.fillRect(0, 0, width, height);
    context.fillStyle = '#635bff'; context.fillRect(0, 0, width / 2, height / 2);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, { width, height });
}
async function pasteImage(width, height) {
  await writeImage(width, height); await canvasFocus();
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/default-page/document') && response.ok());
  await page.keyboard.press('Control+V'); await saved;
}
try {
  await page.goto(`${process.env.TEST_URL}/design`); await page.locator('.studio[data-server-state="ready"]').waitFor();
  await pasteImage(320, 160);
  assert.equal(await images().count(), 1);
  let pasted = (await doc()).elements.find(e => e.kind === 'image');
  assert.equal(pasted.width, 320); assert.equal(pasted.height, 160); assert.equal(pasted.parentId, undefined);
  assert.ok(pasted.component.src.startsWith('data:image/png;base64,'));
  const src = pasted.component.src;
  await canvasFocus(); await page.keyboard.press('Control+Z'); assert.equal(await images().count(), 0);
  await page.keyboard.press('Control+Shift+Z'); assert.equal(await images().count(), 1);
  await images().first().click(); await page.keyboard.press('Control+C'); await page.keyboard.press('Control+V');
  await page.waitForFunction(() => document.querySelectorAll('.artboard .node:has(.prototype-image)').length === 2);
  assert.equal(await images().count(), 2, '画布内部复制粘贴继续有效');
  await pasteImage(160, 320);
  assert.equal(await images().count(), 3, '系统图片优先于之前复制的画布元素');
  assert.ok((await doc()).elements.some(e => e.kind === 'image' && e.width === 160 && e.height === 320));
  await page.evaluate(() => navigator.clipboard.writeText('普通文字粘贴'));
  const name = page.getByRole('textbox', { name: '元素名称', exact: true });
  await name.fill(''); await name.press('Control+V'); assert.equal(await name.inputValue(), '普通文字粘贴');
  assert.equal(await images().count(), 3, '文字输入不创建图片或复制旧元素');
  await canvasFocus();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(['bad image'], 'bad.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.getByText('剪贴板图片无法解码，请重新复制图片', { exact: true }).waitFor();
  assert.equal(await images().count(), 3);
  await page.locator('.node[data-id="add"]').click(); await button('交互').click(); await button('编辑目标弹窗').click();
  await page.getByText('正在编辑弹窗 · 新增成员', { exact: true }).waitFor();
  await pasteImage(160, 320);
  assert.equal(await images().count(), 1);
  const dialogImage = (await doc()).elements.find(e => e.kind === 'image' && e.parentId);
  assert.ok(dialogImage);
  await button('返回页面').click(); assert.equal(await images().count(), 3);
  await page.reload(); await page.locator('.studio[data-server-state="ready"]').waitFor(); assert.equal(await images().count(), 3);
  assert.ok((await doc()).elements.some(e => e.kind === 'image' && e.component.src === src));
  const preview = await openPreview(page, errors);
  assert.equal(await preview.locator('.prototype-image img').count(), 3);
  assert.equal(await preview.locator('.prototype-image img').first().evaluate(img => img.complete && img.naturalWidth > 0), true);
  await preview.close();
  assert.deepEqual(modelCalls, [], '普通图片粘贴不调用模型');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/image-paste-created.png', animations: 'disabled' });
  console.log('PASS: 原生 Ctrl+V 粘贴普通图片、比例和内嵌存储、撤销重做、内部复制、系统图片优先、文字输入隔离、坏图提示、弹窗归属、保存重载和预览，无 AI 调用。');
} finally { await browser.close(); }
