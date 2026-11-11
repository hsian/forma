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
const endpoint = `${process.env.TEST_URL}/api/pages/default-page/ai`;
const state = async () => (await page.request.get(endpoint + '/messages')).json();
async function menu(label) { await button('管理 AI 对话').click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); }
async function send(text) {
  await page.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill(text);
  const refreshed = page.waitForResponse(response => response.url() === endpoint + '/messages' && response.ok());
  await button('发送 AI 修改要求').click();
  await button('停止 AI 生成').waitFor(); await button('发送 AI 修改要求').waitFor();
  await refreshed;
}
try {
  await page.goto(`${process.env.TEST_URL}/design`); await page.locator('.studio[data-server-state="ready"]').waitFor();
  await page.keyboard.press('Control+Shift+Backquote'); await button('展开 AI 对话记录').click();
  await send('只讨论：第一段需求');
  const first = await state(); assert.equal(first.messages.length, 2);
  const original = await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/document`)).json();
  await menu('新对话（自动归档当前聊天）');
  await page.locator('.ai-welcome').waitFor(); assert.equal((await state()).messages.length, 0);
  await send('只讨论：第二段需求');
  assert.notEqual((await state()).conversation.id, first.conversation.id);
  await menu('历史对话');
  await page.locator('.ai-archive-row').getByText('只讨论：第一段需求', { exact: true }).click();
  await page.locator('.ai-archive-messages').getByText('只讨论：第一段需求', { exact: true }).waitFor();
  await page.locator('.ant-spin-spinning').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/ai-conversation-history.png', fullPage: true, animations: 'disabled' });
  await button('恢复并继续聊').click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await state()).conversation.id, first.conversation.id);
  await page.reload(); await page.locator('.studio[data-server-state="ready"]').waitFor();
  if (!await page.locator('.ai-panel').isVisible()) await page.keyboard.press('Control+Shift+Backquote');
  if (await button('展开 AI 对话记录').isVisible()) await button('展开 AI 对话记录').click();
  await page.locator('.ai-messages').getByText('只讨论：第一段需求', { exact: true }).waitFor();
  await menu('删除当前对话'); await button('取消').click(); assert.equal((await state()).messages.length, 2);
  await menu('删除当前对话'); await button('永久删除').click(); await page.locator('.ai-welcome').waitFor();
  assert.equal((await state()).messages.length, 0);
  await menu('历史对话'); await page.locator('.ai-archive-row').getByText('只讨论：第二段需求', { exact: true }).waitFor();
  await button('清空本页全部对话').click(); await button('永久删除').click();
  await page.getByText('暂无归档。点击“新对话”后，当前聊天会保存在这里。', { exact: true }).waitFor();
  assert.equal((await (await page.request.get(endpoint + '/conversations')).json()).conversations.length, 0);
  assert.deepEqual(await (await page.request.get(`${process.env.TEST_URL}/api/pages/default-page/document`)).json(), original);
  assert.deepEqual(errors, []);
  console.log('PASS conversation archive, restore, cancellation, delete, clear and reload');
} finally { await browser.close(); }
