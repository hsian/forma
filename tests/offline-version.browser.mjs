import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试数据库');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const editor = await authenticatedPage(browser, { viewport: { width: 1440, height: 1000 } });
const base = process.env.TEST_URL;
const errors = []; editor.on('pageerror', error => errors.push(error.message));
async function api(path, method = 'GET', data) {
  const response = await editor.request.fetch(base + path, { method, ...(data ? { data } : {}) });
  assert.equal(response.ok(), true, await response.text()); return response.json();
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
let offline;
try {
  const original = await api('/api/pages/default-page/document');
  const sample = original.document.elements.find(element => element.id === 'query');
  const element = (id, kind, text, x, y, width, height, extra = {}) => ({ ...sample, id, kind, name: text, text, x, y, width, height, fill: kind === 'button' ? '#635bff' : '#ffffff', color: kind === 'button' ? '#ffffff' : '#273247', hidden: false, locked: false, action: 'none', component: undefined, ...extra });
  const doc = { width: 900, height: 600, background: '#ffffff', elements: [
    element('offline-title', 'text', '冻结版本首页', 20, 20, 300, 30),
    element('offline-image', 'image', '备份图片', 700, 20, 100, 80, { component: { src: png } }),
    element('filter', 'select', '选择状态', 20, 80, 150, 34, { select: { options: [{ id: 'enabled', label: '启用' }, { id: 'disabled', label: '停用' }], defaultValues: [], multiple: false, allowClear: true, disabled: false } }),
    element('open-dialog', 'button', '查看详情', 200, 80, 120, 34, { action: 'modal', modalId: 'offline-dialog' }),
    element('table', 'table', '离线表格', 20, 140, 650, 220, { table: { columns: [{ key: 'name', title: '姓名' }, { key: 'status', title: '状态' }], rows: [{ name: '甲', status: 'enabled' }, { name: '乙', status: 'disabled' }], pageSize: 10, filters: [{ sourceId: 'filter', fields: ['status'], mode: 'equals', live: true }] } }),
    element('dialog-text', 'text', '离线弹窗内容', 20, 20, 280, 30, { parentId: 'offline-dialog' }),
    element('dialog-close', 'button', '关闭详情', 20, 80, 100, 34, { parentId: 'offline-dialog', action: 'closeModal' }),
  ], dialogs: [{ id: 'offline-dialog', title: '离线详情', width: 360, height: 160, background: '#ffffff' }], annotations: [{ id: 'offline-note', number: 1, x: .5, y: .7, title: '离线标注', content: '无需服务器' }] };
  await api('/api/pages/default-page/document', 'PUT', { revision: original.revision, document: doc });
  const child = await api('/api/projects/default-project/pages', 'POST', { name: '离线子页面', parentId: 'default-page' });
  const childDoc = structuredClone(doc); childDoc.elements[0].text = '子页面快照';
  childDoc.elements.push(element('literal', 'text', '</script><script>window.exportInjected=true</script>', 20, 400, 800, 30));
  await api(`/api/pages/${child.id}/document`, 'PUT', { revision: 0, document: childDoc });
  await editor.goto(base + '/design'); await editor.locator('.studio[data-server-state="ready"]').waitFor();
  await editor.getByRole('button', { name: '项目版本管理', exact: true }).click();
  await editor.getByRole('button', { name: '确认新的迭代版本', exact: true }).click();
  await editor.getByRole('textbox', { name: '迭代版本名称', exact: true }).fill('离线 V1');
  await editor.getByRole('button', { name: '确认固定版本', exact: true }).click();
  const card = editor.locator('.version-card').filter({ hasText: '离线 V1' }); await card.waitFor();
  const downloadEvent = editor.waitForEvent('download');
  await card.getByRole('button', { name: /的更多操作$/ }).click();
  await editor.getByRole('menuitem', { name: '导出 HTML', exact: true }).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /离线 V1\.html$/);
  const file = resolve('test-results/离线原型 V1.html'); await download.saveAs(file);
  const versions = await api('/api/projects/default-project/versions');
  await api(`/api/projects/default-project/versions/${versions.versions[0].id}`, 'DELETE');
  await api(`/api/pages/${child.id}`, 'DELETE');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true });
  offline = await context.newPage(); offline.on('pageerror', error => errors.push(error.message));
  const network = []; offline.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await offline.goto(pathToFileURL(file).href); await offline.locator('.preview-page').waitFor();
  await offline.getByText('离线 V1 · 离线预览', { exact: true }).waitFor();
  await offline.locator('[data-preview-id="offline-title"]').getByText('冻结版本首页', { exact: true }).waitFor();
  assert.equal(await offline.getByRole('button', { name: '返回编辑', exact: true }).count(), 0);
  assert.equal(await offline.locator('[data-preview-id="offline-image"] img').evaluate(image => image.complete && image.naturalWidth === 1), true);
  await offline.getByRole('button', { name: '查看详情', exact: true }).click();
  await offline.getByRole('dialog').getByText('离线弹窗内容', { exact: true }).waitFor();
  await offline.getByRole('button', { name: '关闭详情', exact: true }).click();
  await offline.getByRole('dialog').waitFor({ state: 'hidden' });
  await offline.locator('[data-preview-id="filter"] .ant-select').click();
  await offline.getByText('启用', { exact: true }).click();
  await offline.locator('[data-preview-id="table"]').getByText('甲', { exact: true }).waitFor();
  assert.equal(await offline.locator('[data-preview-id="table"]').getByText('乙', { exact: true }).count(), 0);
  await offline.getByRole('button', { name: '重置离线预览', exact: true }).click();
  await offline.locator('[data-preview-id="table"]').getByText('乙', { exact: true }).waitFor();
  await offline.getByRole('button', { name: '显示预览标注', exact: true }).click();
  await offline.getByRole('button', { name: '标注 1：离线标注', exact: true }).click();
  await offline.getByText('无需服务器', { exact: true }).waitFor();
  await offline.locator('.preview-page-tree').getByText('离线子页面', { exact: true }).click();
  await offline.locator('[data-preview-id="offline-title"]').getByText('子页面快照', { exact: true }).waitFor();
  assert.equal(await offline.evaluate(() => window.exportInjected), undefined);
  await offline.reload(); await offline.locator('[data-preview-id="offline-title"]').getByText('子页面快照', { exact: true }).waitFor();
  assert.match(offline.url(), /^file:/); assert.deepEqual(network, []); assert.deepEqual(errors, []);
  await offline.screenshot({ path: 'test-results/offline-version.png', animations: 'disabled' });
  console.log('PASS: 单文件 HTML 下载、删除服务端版本与页面后断网打开、图片、页面树、刷新、弹窗、筛选、重置与标注，无网络请求。');
} catch (error) { if (offline) await offline.screenshot({ path: 'test-results/offline-version-failure.png', animations: 'disabled' }); throw error; }
finally { await browser.close(); }
