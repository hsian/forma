import { authenticatedPage } from './browser-auth.mjs';
import { openPreview } from './preview-helpers.mjs';
import { tsImport } from 'tsx/esm/api';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const { makeElement } = await tsImport('../shared/model.ts', import.meta.url);
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await authenticatedPage(browser, { viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const color = locator => locator.evaluate(node => getComputedStyle(node).color);
async function assertColor(locator, expected, message) {
  // Ant Design animates the text color when the active tab changes.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await color(locator) === expected) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.equal(await color(locator), expected, message);
}
let preview;
try {
  const url = `${process.env.TEST_URL}/api/pages/default-page/document`;
  const initial = await (await page.request.get(url)).json();
  const elements = ['tabs', 'tabs', 'checkbox', 'tree', 'radio'].map((kind, i) => ({
    ...makeElement(kind, 30, 30 + i * 95), id: `color-${i}`, width: 450, height: 85,
    color: i === 1 ? '#008844' : '#1677ff',
    ...(i === 1 ? { component: { selectedColor: '#1677ff', unselectedColor: '#000000' } } : {}),
    ...(i === 3 ? { component: { selectedBackground: '#cceeff', selectedColor: '#003366', hoverBackground: '#ffeecc' } } : {}),
    ...(['tabs', 'checkbox', 'tree'].includes(kind) ? { choices: { options: [{ id: 'one', label: '正常使用账套' }, { id: 'two', label: '停用注销账套' }], defaultValues: ['one'] } } : {}),
  }));
  const saved = await page.request.put(url, { data: { revision: initial.revision, document: { width: 900, height: 700, background: '#ffffff', elements } } });
  assert.equal(saved.status(), 200, await saved.text());
  await page.goto(`${process.env.TEST_URL}/design`);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  const editor = id => page.locator(`.artboard [data-id="${id}"]`);
  for (const tab of await editor('color-0').getByRole('tab').all()) assert.equal(await color(tab), 'rgb(22, 119, 255)');
  assert.equal(await color(editor('color-1').getByRole('tab').first()), 'rgb(22, 119, 255)', '选中颜色覆盖通用文字颜色');
  assert.equal(await color(editor('color-1').getByRole('tab').last()), 'rgb(0, 0, 0)', '未选中文字可以独立设置黑色');
  assert.equal(await color(editor('color-2').locator('.ant-checkbox-wrapper').first()), 'rgb(22, 119, 255)');
  assert.equal(await color(editor('color-3').locator('.ant-tree')), 'rgb(22, 119, 255)');
  const selectedTreeNode = editor('color-3').locator('.ant-tree-node-selected');
  assert.equal(await selectedTreeNode.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(204, 238, 255)');
  assert.equal(await color(selectedTreeNode), 'rgb(0, 51, 102)');
  assert.equal(await color(editor('color-4').locator('.ant-radio-wrapper').first()), 'rgb(22, 119, 255)');
  preview = await openPreview(page, errors);
  const tabs = preview.locator('[data-preview-id="color-0"]');
  const tree = preview.locator('[data-preview-id="color-3"]');
  const secondNode = tree.locator('.ant-tree-node-content-wrapper').last();
  await secondNode.hover();
  await preview.waitForFunction(() => {
    const nodes = document.querySelectorAll('[data-preview-id="color-3"] .ant-tree-node-content-wrapper');
    return getComputedStyle(nodes[nodes.length - 1]).backgroundColor === 'rgb(255, 238, 204)';
  });
  await secondNode.click();
  await tabs.hover();
  await preview.waitForFunction(() => {
    const selected = document.querySelector('[data-preview-id="color-3"] .ant-tree-node-selected');
    return selected?.textContent === '停用注销账套' && getComputedStyle(selected).backgroundColor === 'rgb(204, 238, 255)';
  });
  await assertColor(tree.locator('.ant-tree-node-selected'), 'rgb(0, 51, 102)', '选中新节点后使用配置的文字颜色');
  await tabs.getByRole('tab').last().click();
  await tabs.getByRole('tab').first().hover();
  assert.equal(await color(tabs.getByRole('tab').first()), 'rgb(22, 119, 255)', '悬停颜色使用配置值');
  assert.equal(await color(tabs.getByRole('tab').last()), 'rgb(22, 119, 255)', '切换后的选中颜色使用配置值');
  assert.equal(await tabs.locator('.ant-tabs-ink-bar').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 119, 255)');
  const stateTabs = preview.locator('[data-preview-id="color-1"]');
  assert.equal(await color(stateTabs.getByRole('tab').first()), 'rgb(22, 119, 255)');
  assert.equal(await color(stateTabs.getByRole('tab').last()), 'rgb(0, 0, 0)');
  await stateTabs.getByRole('tab').last().click();
  await tabs.hover();
  await assertColor(stateTabs.getByRole('tab').first(), 'rgb(0, 0, 0)', '切换后原选中项变黑');
  await assertColor(stateTabs.getByRole('tab').last(), 'rgb(22, 119, 255)', '切换后新选中项变蓝');
  assert.equal(await stateTabs.locator('.ant-tabs-ink-bar').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(22, 119, 255)', '下划线默认沿用选中文字颜色');
  await page.reload();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  assert.equal(await color(editor('color-0').getByRole('tab').first()), 'rgb(22, 119, 255)', '刷新后颜色保持一致');
  await editor('color-1').click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByLabel('Tabs 选中文字颜色', { exact: true }).inputValue(), '#1677ff');
  assert.equal(await page.getByLabel('Tabs 未选中文字颜色', { exact: true }).inputValue(), '#000000');
  assert.equal(await page.getByLabel('Tabs 选中下划线颜色', { exact: true }).inputValue(), '#1677ff');
  await editor('color-3').click({ position: { x: 5, y: 5 } });
  assert.equal(await page.getByLabel('Tree 选中背景颜色', { exact: true }).inputValue(), '#cceeff');
  assert.equal(await page.getByLabel('Tree 选中文字颜色', { exact: true }).inputValue(), '#003366');
  assert.equal(await page.getByLabel('Tree 悬停背景颜色', { exact: true }).inputValue(), '#ffeecc');
  await page.screenshot({ path: 'test-results/element-colors.png' });
  assert.deepEqual(errors, []);
} finally {
  await preview?.close();
  await browser.close();
}
