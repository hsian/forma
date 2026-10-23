import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('请使用 npm run test:browser，避免修改工作数据库');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const base = process.env.TEST_URL;
let pageId;
const titleOf = data => data.document.elements.find(element => element.id === 'title').text;
async function readDocument() { return (await page.request.get(`${base}/api/pages/${pageId}/document`)).json(); }
async function editTitle(target, text) {
  await target.locator('.node[data-id="title"]').click();
  await target.getByRole('textbox', { name: '文字内容', exact: true }).fill(text);
}
async function waitSaved(target, text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (titleOf(await readDocument()) === text && await target.locator('[data-save-status="saved"]').count()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`未保存预期文本：${text}`);
}
try {
  await page.goto(base);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  pageId = (await (await page.request.get(`${base}/api/bootstrap`)).json()).page.id;
  let holdFirstResponse = true;
  let simulateFailure = false;
  let simulateLostAck = false;
  let firstCommittedResolve;
  const firstCommitted = new Promise(resolve => { firstCommittedResolve = resolve; });
  let writes = 0;
  await page.route('**/api/pages/*/document', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    writes++;
    if (simulateFailure) {
      simulateFailure = false;
      return route.fulfill({ status: 503, json: { message: '测试保存失败' } });
    }
    if (simulateLostAck) {
      simulateLostAck = false;
      const committed = await route.fetch();
      assert.equal(committed.status(), 200);
      return route.fulfill({ status: 503, json: { message: '测试响应丢失' } });
    }
    if (holdFirstResponse) {
      holdFirstResponse = false;
      const committed = await route.fetch();
      firstCommittedResolve();
      await new Promise(resolve => setTimeout(resolve, 800));
      return route.fulfill({ response: committed });
    }
    return route.continue();
  });
  await editTitle(page, '第一次保存');
  await firstCommitted;
  await editTitle(page, '请求期间继续编辑');
  await waitSaved(page, '请求期间继续编辑');
  assert.equal(writes, 2, 'in-flight edits must be saved by one serialized follow-up request');
  await page.reload();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  assert.equal(await page.locator('.node[data-id="title"] .text-content').innerText(), '请求期间继续编辑');
  await editTitle(page, '手动立即保存');
  await page.getByRole('textbox', { name: '文字内容', exact: true }).press('Control+s');
  await waitSaved(page, '手动立即保存');

  const beforeFailure = await readDocument();
  simulateFailure = true;
  await editTitle(page, '失败后重试');
  await page.locator('[data-save-status="error"]').waitFor();
  assert.equal(titleOf(await readDocument()), titleOf(beforeFailure));
  assert.equal(await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '失败后重试');
  await page.clock.install(); await page.clock.fastForward(65000);
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/pages/default-page/lease')).json()).lease.owned), true, '未保存的修改不能因空闲而释放编辑权');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await waitSaved(page, '失败后重试');

  const beforeLostAck = await readDocument();
  simulateLostAck = true;
  await editTitle(page, '网络确认恢复');
  await page.locator('[data-save-status="error"]').waitFor();
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await waitSaved(page, '网络确认恢复');
  assert.equal((await readDocument()).revision, beforeLostAck.revision + 1, 'lost acknowledgment retry must not write twice');

  const second = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
  second.on('pageerror', error => errors.push(error.message));
  await second.goto(base);
  await second.locator('.studio[data-server-state="ready"]').waitFor();
  await editTitle(page, '窗口一已保存');
  await waitSaved(page, '窗口一已保存');
  await page.clock.fastForward(65000);
  await page.waitForFunction(async () => !(await (await fetch('/api/pages/default-page/lease')).json()).lease.expiresAt);
  await second.clock.install(); await second.clock.fastForward(20000);
  await second.locator('.node[data-id="title"] .text-content').getByText('窗口一已保存', { exact: true }).waitFor();
  await editTitle(second, '窗口二获得编辑权');
  await waitSaved(second, '窗口二获得编辑权');
  // Even a lease owner must still satisfy revision checks when its loaded version is stale.
  const advanced = await readDocument();
  const advance = await second.request.put(`${base}/api/pages/${pageId}/document`, { data: { revision: advanced.revision, document: advanced.document } });
  assert.equal(advance.ok(), true);
  await editTitle(second, '窗口二未保存的修改');
  await second.locator('[data-save-status="conflict"]').waitFor();
  assert.equal(titleOf(await readDocument()), '窗口二获得编辑权');
  assert.equal(await second.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '窗口二未保存的修改');
  await second.getByRole('button', { name: '读取服务器版本', exact: true }).click();
  await second.getByRole('dialog').getByRole('button', { name: '重新载入', exact: true }).click();
  await second.locator('[data-save-status="saved"]').waitFor();
  assert.equal(await second.locator('.node[data-id="title"] .text-content').innerText(), '窗口二获得编辑权');
  await second.close();
  await page.waitForFunction(async () => !(await (await fetch('/api/pages/default-page/lease')).json()).lease.expiresAt);
  await page.clock.fastForward(20000);
  await page.locator('.node[data-id="title"] .text-content').getByText('窗口二获得编辑权', { exact: true }).waitFor();
  await page.setViewportSize({ width: 760, height: 1000 });
  simulateFailure = true;
  await editTitle(page, '窄屏保存验证');
  await page.locator('[data-save-status="error"]').waitFor();
  assert.ok(await page.getByRole('button', { name: '重试保存', exact: true }).isVisible());
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await waitSaved(page, '窄屏保存验证');
  assert.deepEqual(errors, []);
  console.log('PASS: autosave, serialized writes, reload recovery, error/retry, lost-ack recovery, concurrent-tab conflict protection and explicit reload.');
} finally { await browser.close(); }
