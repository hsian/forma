import { authenticatedPage } from './browser-auth.mjs';
import { sketchFixture } from './fixtures/sketch.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const button = name => page.getByRole('button', { name, exact: true });
async function ready(panel) {
  await page.waitForFunction(id => document.getElementById(id)?.getAttribute('aria-busy') === 'false', await panel.getAttribute('id'));
}
async function pasteFile(panel, label, type, base64) {
  await ready(panel);
  await panel.getByRole('textbox', { name: label, exact: true }).evaluate((element, file) => {
    const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], '粘贴图片', { type: file.type }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, { type, base64 });
}
async function paste(panel, label) {
  await pasteFile(panel, label, 'image/png', png);
  await panel.getByAltText('AI 参考图片', { exact: true }).waitFor();
}
try {
  await page.goto(process.env.TEST_URL + '/design');
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  const original = (await (await page.request.get(process.env.TEST_URL + '/api/pages/default-page/document')).json()).document;
  await page.keyboard.press('Control+Backquote');
  const panel = page.getByRole('region', { name: 'AI 助手', exact: true });
  await ready(panel);
  assert.equal(await panel.getByRole('button', { name: '上传 AI 参考图片', exact: true }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: '撤销本轮 AI 修改', exact: true }).count(), 0);
  await paste(panel, 'AI 修改要求');
  await panel.getByAltText('AI 参考图片', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/chat-image-prototype.png', animations: 'disabled' });
  await panel.getByAltText('AI 参考图片', { exact: true }).click();
  await page.locator('.ant-image-preview-img').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.ant-image-preview-wrap').waitFor({ state: 'hidden' });
  const sent = page.waitForRequest(request => request.url().endsWith('/ai/turn') && request.method() === 'POST');
  await button('发送 AI 修改要求').click();
  assert.equal((await sent).postDataJSON().image, 'data:image/png;base64,' + png);
  await panel.getByText('已读取参考图片，可以结合当前页面讨论。', { exact: true }).last().waitFor();
  assert.equal(await panel.getByAltText('AI 参考图片', { exact: true }).count(), 0);
  await paste(panel, 'AI 修改要求');
  await panel.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('FAIL');
  await button('发送 AI 修改要求').click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByAltText('AI 参考图片', { exact: true }).count(), 1, '失败后保留图片重试');
  await panel.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('STOP');
  await button('发送 AI 修改要求').click();
  await button('停止 AI 生成').click();
  await ready(panel);
  assert.equal(await panel.getByAltText('AI 参考图片', { exact: true }).count(), 1, '停止后保留图片重试');
  await page.mouse.move(0, 0);
  await button('移除 AI 参考图片').click();
  await panel.getByRole('textbox', { name: 'AI 修改要求', exact: true }).clear();
  await pasteFile(panel, 'AI 修改要求', 'image/svg+xml', Buffer.from('<svg/>').toString('base64'));
  await panel.getByText('支持 PNG、JPEG 图片', { exact: true }).waitFor();
  assert.equal(await panel.getByAltText('AI 参考图片', { exact: true }).count(), 0);
  const upload = await page.request.post(process.env.TEST_URL + '/api/projects/default-project/sketch', { headers: { 'Content-Type': 'application/octet-stream' }, data: sketchFixture() });
  assert.equal(upload.ok(), true, await upload.text());
  const imported = await page.request.post(`${process.env.TEST_URL}/api/projects/default-project/sketch/${(await upload.json()).token}/import`, { data: { pageId: 'p', boardId: 'board', targetPageId: 'default-page', acceptWarnings: true } });
  assert.equal(imported.ok(), true, await imported.text());
  await button('刷新页面列表').click(); await button('查看 UI 设计稿 用户管理').click();
  await page.locator('.ui-design-board').waitFor(); await page.keyboard.press('Control+Backquote');
  const design = page.getByRole('region', { name: '设计稿 AI 助手', exact: true });
  await paste(design, '设计稿 AI 问题');
  await page.screenshot({ path: 'test-results/chat-image-design.png', animations: 'disabled' });
  await button('发送设计稿 AI 问题').click();
  await design.getByText('已读取参考图片，可以结合当前页面讨论。', { exact: true }).last().waitFor();
  assert.equal(await design.getByAltText('AI 参考图片', { exact: true }).count(), 0);
  await button('展开设计稿 AI 对话').click();
  await design.getByText('[附图，仅供本轮参考]', { exact: false }).waitFor();
  assert.deepEqual((await (await page.request.get(process.env.TEST_URL + '/api/pages/default-page/document')).json()).document, original, '输入框附图不粘贴到原型画布');
  assert.deepEqual(errors, []);
  console.log('PASS: 两种 AI 输入框粘贴/预览/发送图片、失败保留、非法格式拒绝，画布不插入附件。');
} catch (error) { await page.screenshot({ path: 'test-results/chat-images-failure.png', animations: 'disabled' }); throw error; }
finally { await browser.close(); }
