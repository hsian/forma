import { tsImport } from 'tsx/esm/api';
import { authenticatedPage } from './browser-auth.mjs';
import { openPreview } from './preview-helpers.mjs';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const { imageTableDocument } = await tsImport('./fixtures/image-table.ts', import.meta.url);
if (!process.env.TEST_URL) throw Error('必须使用隔离测试数据库');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await authenticatedPage(browser, { viewport: { width: 1840, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const endpoint = `${process.env.TEST_URL}/api/pages/default-page/document`;
async function load(document) {
  const old = await (await page.request.get(endpoint)).json();
  const saved = await page.request.put(endpoint, { data: { revision: old.revision, document } });
  assert.equal(saved.status(), 200, await saved.text());
  await page.request.delete(endpoint.replace('/document', '/lease'));
  await page.goto(`${process.env.TEST_URL}/design`); await page.locator('.studio[data-server-state="ready"]').waitFor();
}
async function verifyTable(table) {
  assert.equal(await table.locator('.ant-table-row').count(), 4);
  assert.equal(await table.locator('.ant-pagination').count(), 0);
  const bounds = await table.boundingBox();
  for (const row of await table.locator('.ant-table-row').all()) {
    const box = await row.boundingBox(); assert.ok(box.y + box.height <= bounds.y + bounds.height + 1, '四行必须全部位于表格可见区域');
  }
  const header = await table.locator('th').first().evaluate(el => ({ height: el.getBoundingClientRect().height, wrap: getComputedStyle(el).whiteSpace }));
  assert.ok(header.height <= 33); assert.equal(header.wrap, 'nowrap');
}
try {
  for (const explicit of [false, true]) {
    await load(imageTableDocument(explicit));
    const table = page.locator('.node[data-id="image-bank-table"]'); await verifyTable(table);
    if (explicit) {
      const style = await table.locator('th').first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, align: getComputedStyle(el).textAlign, fontSize: getComputedStyle(el).fontSize }));
      assert.deepEqual(style, { background: 'rgb(227, 239, 255)', align: 'center', fontSize: '14px' });
    }
    const color = await page.locator('.node[data-id="work-tab"] button').evaluate(el => getComputedStyle(el).color);
    assert.equal(color, 'rgb(99, 117, 138)', '文字按钮使用指定的文字颜色');
    const preview = await openPreview(page, errors);
    await verifyTable(preview.locator('[data-preview-id="image-bank-table"]'));
    await preview.close();
  }
  const scrolling = imageTableDocument(true);
  scrolling.elements[2].height = 190;
  scrolling.elements[2].table.scrollWidth = 2100;
  scrolling.elements[2].table.columns.at(-1).fixed = 'right';
  await load(scrolling);
  const preview = await openPreview(page, errors);
  const table = preview.locator('[data-preview-id="image-bank-table"]');
  await verifyTable(table);
  const fixedBefore = await table.locator('.ant-table-row').first().locator('td').last().boundingBox();
  const scrolled = await table.locator('.ant-table-content').evaluate(el => { el.scrollLeft = 250; return { width: el.scrollWidth, viewport: el.clientWidth, left: el.scrollLeft }; });
  assert.ok(scrolled.width > scrolled.viewport); assert.equal(scrolled.left, 250);
  const fixedAfter = await table.locator('.ant-table-row').first().locator('td').last().boundingBox();
  assert.ok(Math.abs(fixedBefore.x - fixedAfter.x) < 1, '固定列不随内容滚动');
  await preview.close();
  // Optional local reproduction of the user's saved generation; never sends images to a model.
  if (process.env.IMAGE_TABLE_EXISTING_RESULT) {
    await load(JSON.parse(await readFile(process.env.IMAGE_TABLE_EXISTING_RESULT, 'utf8')));
    const table = page.locator('.node[data-id="bank_accounts_table"]');
    await verifyTable(table);
    assert.equal(await table.locator('th').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(229, 239, 252)');
    assert.equal(await table.locator('.ant-table-row td').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await table.locator('.ant-table-row td').first().evaluate(el => getComputedStyle(el).borderBottomColor), 'rgb(217, 217, 217)');
    await page.locator('.artboard').first().screenshot({ path: 'test-results/image-table-existing-fixed.png' });
  }
  await page.reload(); await page.locator('.studio[data-server-state="ready"]').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: 四行紧凑表格完整可见、显式高度和颜色生效、表头不换行、无额外分页、文字按钮颜色、预览和重载。');
} finally { await browser.close(); }
