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
async function leavePreview() { await page.close(); page = editorPage; await page.bringToFront(); }
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const button = name => page.getByRole('button', { name, exact: true });
const textbox = name => page.getByRole('textbox', { name, exact: true });
const editorDefault = () => page.locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '默认选中项', exact: true }) });
async function openSelect(select) {
  if (await select.getByRole('combobox').getAttribute('aria-expanded') !== 'true') await select.click();
  const options = select.locator('..').locator('.ant-select-item-option');
  await options.first().waitFor();
  return options;
}
await mkdir('test-results', { recursive: true });
try {
  await page.goto(process.env.TEST_URL);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await page.getByRole('button', { name: '元素', exact: true }).click();
  await page.getByPlaceholder('搜索元素', { exact: true }).fill('select');
  assert.equal(await page.locator('.element-card').count(), 2, 'Select 和 TreeSelect 都可通过英文搜索');
  await button('Select 选择器').click();
  const id = await page.locator('.node-selected').getAttribute('data-id');
  const node = page.locator(`.node[data-id="${id}"]`);
  await textbox('元素名称').fill('业务分类');
  for (const [name, value] of [['X', '680'], ['Y', '100'], ['W', '320']]) {
    const input = page.getByRole('spinbutton', { name, exact: true });
    await input.fill(value); await input.press('Tab');
  }
  assert.equal(await textbox('选项 1 名称').inputValue(), '选项一');
  await textbox('选项 1 名称').fill('产品');
  await textbox('选项 2 名称').fill('研发');
  await button('添加选项').click();
  await textbox('选项 3 名称').fill('运营');
  await editorDefault().click();
  await page.locator('.ant-select-item-option:visible').filter({ hasText: /^研发$/ }).click();
  await button('上移选项 3').click();
  assert.deepEqual(await page.locator('.select-option-row input').evaluateAll(inputs => inputs.map(input => input.value)), ['产品', '运营', '研发']);
  assert.ok((await editorDefault().innerText()).includes('研发'));
  await button('删除选项 3').click();
  assert.ok((await editorDefault().innerText()).includes('不预选'));
  await button('撤销 Ctrl+Z').click();
  await node.click();
  assert.equal(await textbox('选项 3 名称').inputValue(), '研发');
  assert.ok((await editorDefault().innerText()).includes('研发'));
  await page.getByRole('switch', { name: '多选模式', exact: true }).click();
  await editorDefault().click();
  await page.locator('.ant-select-item-option:visible').filter({ hasText: /^产品$/ }).click();
  await page.locator('.ant-select-item-option:visible').filter({ hasText: /^运营$/ }).click();
  await page.getByRole('combobox', { name: '默认选中项', exact: true }).press('Escape');
  await page.getByRole('switch', { name: '允许清空', exact: true }).click();
  await page.getByRole('switch', { name: '禁用控件', exact: true }).click();
  await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'test-results/select-properties.png', fullPage: true });
  page = await openPreview(editorPage, errors);
  assert.ok(await page.getByRole('combobox', { name: '业务分类', exact: true }).isDisabled());
  await page.waitForFunction(() => document.querySelectorAll('.preview-page .ant-select-multiple .ant-select-selection-overflow-item:not([aria-hidden="true"]) > .ant-select-selection-item').length === 3);
  assert.equal(await page.locator('.preview-page .ant-select-multiple .ant-select-selection-overflow-item:not([aria-hidden="true"]) > .ant-select-selection-item').count(), 3);
  assert.equal(await page.locator('.preview-page .ant-select-multiple .ant-select-clear').count(), 0);
  await leavePreview();
  await page.getByRole('switch', { name: '禁用控件', exact: true }).click();
  await page.getByRole('switch', { name: '允许清空', exact: true }).click();
  page = await openPreview(editorPage, errors);
  const runtimeSelect = page.locator('.preview-page .ant-select').filter({ has: page.getByRole('combobox', { name: '业务分类', exact: true }) });
  await runtimeSelect.hover();
  await runtimeSelect.locator('.ant-select-clear').click();
  assert.equal(await runtimeSelect.locator('.ant-select-selection-overflow-item:not([aria-hidden="true"]) > .ant-select-selection-item').count(), 0);
  const runtimeOptions = await openSelect(runtimeSelect);
  assert.deepEqual(await runtimeOptions.locator('.ant-select-item-option-content').allTextContents(), ['产品', '运营', '研发']);
  await runtimeOptions.filter({ hasText: /^运营$/ }).click();
  await page.getByRole('combobox', { name: '业务分类', exact: true }).press('Escape');
  const status = page.locator('.preview-page .ant-select').filter({ has: page.getByRole('combobox', { name: '状态筛选', exact: true }) });
  const statusOptions = await openSelect(status);
  assert.deepEqual(await statusOptions.locator('.ant-select-item-option-content').allTextContents(), ['正常', '停用']);
  await page.getByRole('combobox', { name: '状态筛选', exact: true }).press('Escape');
  await button('+ 新增成员').click();
  const role = page.getByRole('dialog').locator('.ant-select').filter({ has: page.getByRole('combobox', { name: '角色', exact: true }) });
  const roleOptions = await openSelect(role);
  assert.deepEqual(await roleOptions.locator('.ant-select-item-option-content').allTextContents(), ['管理员', '编辑者', '访客']);
  await page.getByRole('combobox', { name: '角色', exact: true }).press('Escape');
  await button('取消').click();
  await leavePreview();
  await page.getByRole('switch', { name: '多选模式', exact: true }).click();
  page = await openPreview(editorPage, errors);
  assert.equal(await page.locator('.preview-page .ant-select-multiple').count(), 0);
  const single = page.locator('.preview-page .ant-select').filter({ has: page.getByRole('combobox', { name: '业务分类', exact: true }) });
  assert.equal((await single.locator('.ant-select-selection-item').innerText()).trim(), '研发');
  assert.deepEqual(errors, []);
  console.log('PASS: Select library/search, per-instance options, add/rename/delete/reorder, stable defaults, undo, multiple/single, clear/disable, independent page and modal instances.');
} catch (error) {
  await page.screenshot({ path: 'test-results/select-failure.png', fullPage: true });
  console.error(errors);
  throw error;
} finally { await browser.close(); }


