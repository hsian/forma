import { authenticatedPage } from './browser-auth.mjs';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await authenticatedPage(browser, { viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => { if (!error.message.includes('自定义页面运行错误')) errors.push(error.message); });
const base = process.env.TEST_URL;
const button = name => page.getByRole('button', { name, exact: true });
async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error(label);
}
try {
  const created = await page.request.post(`${base}/api/projects`, { data: { name: '运行中的业务工程', application: { templateId: 'admin', directoryName: 'embedded-preview' } } });
  assert.equal(created.ok(), true, await created.text());
  const { project, page: home } = await created.json();
  const doc = (await (await page.request.get(`${base}/api/pages/default-page/document`)).json()).document;
  doc.elements.find(item => item.id === 'title').text = '实际工程的页面';
  const saved = await page.request.put(`${base}/api/pages/${home.id}/document`, { data: { revision: 0, document: doc } });
  assert.equal(saved.ok(), true, await saved.text());
  const second = (await (await page.request.post(`${base}/api/projects/${project.id}/pages`, { data: { name: '第二页' } })).json());
  const secondDoc = { ...doc, elements: [{ ...doc.elements.find(item => item.id === 'title'), text: '实际工程的第二页' }], dialogs: [] };
  await page.request.put(`${base}/api/pages/${second.id}/document`, { data: { revision: 0, document: secondDoc } });
  const logConfig = resolve(project.application.directory, 'vite.config.ts');
  await writeFile(logConfig, `console.log(Array.from({ length: 60 }, (_, i) => '运行日志测试行 ' + i).join('\\n'));\n` + await readFile(logConfig, 'utf8'));
  await page.goto(`${base}/design?projectId=${project.id}&pageId=${home.id}`);
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  const opened = page.waitForEvent('popup');
  await button('预览').click();
  const standalone = await opened;
  await standalone.getByText('实际工程的页面', { exact: true }).waitFor({ timeout: 30000 });
  assert.ok(new URL(standalone.url()).pathname.startsWith(`/__forma_runtime/${project.id}/`));
  assert.equal(await standalone.locator('[data-forma-inspector-overlay]').count(), 0);
  await standalone.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  await standalone.getByRole('dialog').waitFor();
  await standalone.close();
  await button('真实预览').click();
  await page.locator('[data-runtime-state="running"]').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.runtime-inspector-note').isVisible(), true);
  assert.equal(await page.locator('.right-panel > .properties').isVisible(), false);
  const frame = page.frameLocator('iframe[title="真实工程预览"]');
  await frame.getByText('实际工程的页面', { exact: true }).waitFor();
  assert.equal(await page.locator('.canvas-mode-toolbar').getByRole('button').count(), 2);
  assert.equal(await page.locator('.application-runtime-toolbar').count(), 0);
  assert.equal(await button('刷新真实预览').textContent(), '');
  assert.equal(await button('停止真实预览').textContent(), '');
  assert.equal(await page.getByRole('button', { name: '回到画布编辑', exact: true }).count(), 0);
  await button('▸ 运行日志').click();
  const logOutput = page.locator('#runtime-log-output');
  await logOutput.getByText('运行日志测试行 59', { exact: false }).waitFor();
  assert.equal(await logOutput.evaluate(node => node.clientHeight >= 160 && node.scrollHeight > node.clientHeight && node.getBoundingClientRect().bottom <= window.innerHeight), true, '日志应有足够高度、可滚动且位于视口内');
  await button('放大查看').click();
  await page.getByRole('dialog', { name: '运行日志', exact: true }).waitFor();
  assert.equal(await page.locator('.application-runtime-logs-expanded').evaluate(node => node.clientHeight > 500), true);
  await page.getByRole('dialog', { name: '运行日志', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'test-results/runtime-logs.png', fullPage: true, animations: 'disabled' });
  await button('▾ 运行日志').click();
  assert.ok((await page.locator('iframe[title="真实工程预览"]').getAttribute('src')).startsWith(`/__forma_runtime/${project.id}/`));
  await frame.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  await frame.getByRole('dialog').getByRole('textbox', { name: '成员姓名', exact: true }).fill('真实表单输入');
  await button('编辑模式').click();
  await frame.getByRole('dialog').getByRole('textbox', { name: '成员姓名', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '元素名称', exact: true }).inputValue(), doc.elements.find(item => item.parentId && item.name === '成员姓名').name);
  await button('交互预览').click();
  await frame.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  await button('编辑模式').click();
  await frame.getByRole('button', { name: '+ 新增成员', exact: true }).click();
  assert.equal(await frame.getByRole('dialog').isVisible(), false, '选择模式不能执行按钮业务动作');
  await frame.getByText('实际工程的页面', { exact: true }).click();
  await until(async () => await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue() === '实际工程的页面', '选中信息未同步到属性面板');
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('直接修改真实页面');
  await frame.getByText('直接修改真实页面', { exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '直接修改真实页面');
  await until(async () => await frame.locator('[data-forma-inspector-overlay]').first().isVisible(), '保存重载后未恢复选中框');
  // Other windows and unknown IDs cannot drive the property inspector.
  await page.evaluate(() => window.postMessage({ type: 'forma:inspect-select', id: 'query', pageId: new URLSearchParams(location.search).get('pageId') }, location.origin));
  assert.equal(await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '直接修改真实页面');
  await frame.locator('body').evaluate((_, pageId) => {
    window.parent.postMessage({ type: 'forma:inspect-select', id: 'unknown-element', pageId }, location.origin);
    window.parent.postMessage({ type: 'forma:inspect-select', id: 'query', pageId: 'previous-page' }, location.origin);
  }, home.id);
  await page.screenshot({ path: 'test-results/runtime-component-editing.png', fullPage: true, animations: 'disabled' });
  assert.equal(await page.getByRole('textbox', { name: '文字内容', exact: true }).inputValue(), '直接修改真实页面');
  await button('交互预览').click();
  // Change a handwritten extension: a mapping-only preview could not show this.
  const override = resolve(project.application.directory, 'src/extensions/index.tsx');
  const originalOverride = await readFile(override, 'utf8');
  await writeFile(override, originalOverride.replace('= {};', `= { ${JSON.stringify(home.id)}: <FoundationDemo/> };`) + `
import { useCallback, useState } from 'react';
import { useQuery } from '../modules/shared/useQuery';
import { useMutation } from '../modules/shared/useMutation';
const queries = new Map<string, () => void>();
let complete: (() => void) | undefined;
let fail: (() => void) | undefined;
let attempts = 0;
function FoundationDemo() {
  const [key, setKey] = useState('old');
  const [notice, setNotice] = useState('');
  const [input, setInput] = useState('保留的表单输入');
  const query = useQuery(useCallback(() => new Promise<string>(resolve => queries.set(key, () => resolve(key))), [key]));
  const mutation = useMutation(async () => { attempts++; return new Promise<string>((resolve, reject) => { complete = () => resolve('保存成功'); fail = () => reject(Error('保存失败')); }); });
  const save = () => { void mutation.execute({}).then(setNotice).catch(error => setNotice(error.message)); };
  return <div>
    <div data-query-result>{query.data || 'loading'}</div>
    <button onClick={() => setKey('new')}>切换查询</button>
    <button onClick={() => queries.get('new')?.()}>返回新请求</button>
    <button onClick={() => queries.get('old')?.()}>返回旧请求</button>
    <input aria-label="基础表单" value={input} onChange={event => setInput(event.target.value)}/>
    <button onClick={() => { save(); save(); }}>连续提交</button>
    <button onClick={() => complete?.()}>完成提交</button>
    <button onClick={() => fail?.()}>拒绝提交</button>
    <div data-submit-state>{String(mutation.pending)} / {attempts}</div>
    <div data-submit-notice>{notice}</div>
  </div>;
}
`);
  await button('刷新真实预览').click();
  await frame.getByRole('button', { name: '切换查询', exact: true }).click();
  await frame.getByRole('button', { name: '返回新请求', exact: true }).click();
  await until(async () => await frame.locator('[data-query-result]').textContent() === 'new', '新查询未显示');
  await frame.getByRole('button', { name: '返回旧请求', exact: true }).click();
  assert.equal(await frame.locator('[data-query-result]').textContent(), 'new', '过期结果不能覆盖当前查询');
  await frame.getByRole('button', { name: '连续提交', exact: true }).click();
  await frame.getByText('操作正在处理中，请勿重复提交', { exact: true }).waitFor();
  assert.equal(await frame.locator('[data-submit-state]').textContent(), 'true / 1');
  await frame.getByRole('button', { name: '完成提交', exact: true }).click();
  await frame.getByText('保存成功', { exact: true }).waitFor();
  await frame.getByRole('button', { name: '连续提交', exact: true }).click();
  await frame.getByRole('button', { name: '拒绝提交', exact: true }).click();
  await frame.getByText('保存失败', { exact: true }).waitFor();
  assert.equal(await frame.getByRole('textbox', { name: '基础表单', exact: true }).inputValue(), '保留的表单输入');
  await writeFile(override, originalOverride.replace('= {};', `= { ${JSON.stringify(home.id)}: <div data-live-extension="true">来自手写扩展的真实内容</div> };`));
  await button('刷新真实预览').click();
  await frame.getByText('来自手写扩展的真实内容', { exact: true }).waitFor();
  await writeFile(override, originalOverride.replace('= {};', `= { ${JSON.stringify(home.id)}: <ThrowingPage/> };\nfunction ThrowingPage(): never { throw Error('自定义页面运行错误'); }`));
  await button('刷新真实预览').click();
  await page.getByRole('alert').filter({ hasText: '自定义页面运行错误' }).waitFor();
  await writeFile(override, originalOverride);
  await button('刷新真实预览').click();
  await frame.getByText('直接修改真实页面', { exact: true }).waitFor();
  // Saving through the editor reloads the runtime to the published source revision.
  await button('画布编辑').click();
  await page.locator('.node[data-id="title"]').click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('保存后更新的真实页面');
  await button('真实预览').click();
  await frame.getByText('保存后更新的真实页面', { exact: true }).waitFor();
  // AI editing remains usable while the actual app is being experienced.
  await button('真实预览').focus();
  await page.keyboard.press('Control+Backquote');
  await page.getByRole('textbox', { name: 'AI 修改要求', exact: true }).fill('把查询按钮改成蓝色');
  await button('发送 AI 修改要求').click();
  await until(async () => (await (await page.request.get(`${base}/api/pages/${home.id}/document`)).json()).document.elements.find(item => item.id === 'query').fill === '#1677ff', 'AI 修改未保存');
  await until(async () => {
    try { return await frame.getByRole('button', { name: '查询', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor === 'rgb(22, 119, 255)'); } catch { return false; }
  }, '运行页面未显示新保存的源码');
  await button('真实预览').focus(); await page.keyboard.press('Control+Backquote');
  await page.locator('.page-tree-title>span').filter({ hasText: /^第二页$/ }).click();
  await frame.getByText('实际工程的第二页', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/runtime-embedded.png', fullPage: true, animations: 'disabled' });
  await button('停止真实预览').click();
  await page.locator('[data-runtime-state="stopped"]').waitFor();
  assert.equal(await page.locator('iframe[title="真实工程预览"]').count(), 0);
  const config = resolve(project.application.directory, 'vite.config.ts');
  const originalConfig = await readFile(config, 'utf8');
  await writeFile(config, 'throw Error("业务配置需要修复");\nexport default {};\n');
  await button('启动真实预览').click();
  await page.getByRole('alert').filter({ hasText: '业务配置需要修复' }).waitFor();
  await writeFile(config, originalConfig);
  await button('启动真实预览').click();
  await frame.getByText('实际工程的第二页', { exact: true }).waitFor();
  await button('画布编辑').click();
  assert.equal(await page.locator('.canvas-editor-surface').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: 真实组件和弹窗选中、右侧属性保存及重载保持选中、体验模式交互、手写扩展、AI 更新、切页、启动停止与修复重试。');
} catch (error) {
  await page.screenshot({ path: 'test-results/runtime-failure.png', fullPage: true });
  console.error(errors); throw error;
} finally { await browser.close(); }
