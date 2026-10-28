import { tsImport } from 'tsx/esm/api';
import { authenticatedPage } from './browser-auth.mjs';
import { openPreview } from './preview-helpers.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const { bankConnectDocument } = await tsImport('../examples/bank-connect.ts', import.meta.url);
if (!process.env.TEST_URL) throw Error('必须使用隔离数据库');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await authenticatedPage(browser, { viewport: { width: 1840, height: 1100 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  for (const convert of [false, true]) {
    const endpoint = `${process.env.TEST_URL}/api/pages/default-page/document`;
    const old = await (await page.request.get(endpoint)).json();
    assert.equal((await page.request.put(endpoint, { data: { revision: old.revision, document: bankConnectDocument(convert) } })).status(), 200);
    await page.goto(`${process.env.TEST_URL}/design`); await page.locator('.studio[data-server-state="ready"]').waitFor();
    const preview = await openPreview(page, errors);
    if (!convert) {
      await preview.getByRole('textbox', { name: '交易流水号、对方户名、摘要关键词', exact: true }).fill('工程');
      await preview.getByRole('button', { name: '查询', exact: true }).click();
      assert.equal(await preview.locator('.ant-table-tbody tr.ant-table-row').count(), 4);
      await preview.getByRole('button', { name: '详情', exact: true }).first().click();
      await preview.getByRole('dialog').getByText(/示范工程服务公司/).waitFor();
      await preview.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
    } else {
      const table = preview.locator('[data-preview-id="transactions"]');
      await table.getByRole('button', { name: '生成出纳流水', exact: true }).first().click();
      await preview.getByRole('dialog').getByText(/确认将此交易生成出纳流水/).waitFor();
      await preview.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      await table.getByRole('button', { name: '删除', exact: true }).first().click();
      const dialog = preview.getByRole('dialog');
      await dialog.getByText('删除银行动账明细', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: '确定', exact: true }).click();
      await dialog.getByText('请选择删除说明', { exact: true }).waitFor();
      await dialog.getByRole('textbox').fill('重复交易');
      await dialog.getByRole('button', { name: '确定', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await preview.getByRole('tab', { name: '回收站', exact: true }).click();
      await preview.locator('[data-preview-id="recycled"]').waitFor();
    }
    await preview.screenshot({ path: `test-results/bank-connect-${convert ? 'convert' : 'query'}.png` });
    await preview.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: 两页保存载入、查询筛选、行详情、生成确认、删除必填与模拟删除、回收站切换。');
} finally { await browser.close(); }
