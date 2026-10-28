import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

if (!process.env.TEST_URL) throw Error('必须使用隔离测试数据库');
const require = createRequire(process.env.PLAYWRIGHT_MODULE_ROOT ? resolve(process.env.PLAYWRIGHT_MODULE_ROOT, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const base = new URL(process.env.TEST_URL);
base.hostname = 'forma-lan.test';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH,
  args: ['--host-resolver-rules=MAP forma-lan.test 127.0.0.1', '--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base.href);
  assert.deepEqual(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID, random: typeof crypto.getRandomValues })),
    { secure: false, uuid: 'undefined', random: 'function' });
  await page.getByRole('heading', { name: '创建管理员账号', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '用户名', exact: true }).fill('qa-lan-admin');
  await page.getByLabel('密码', { exact: true }).fill('qa-password-123');
  await page.getByLabel('确认密码', { exact: true }).fill('qa-password-123');
  await page.getByRole('button', { name: '创建管理员并进入', exact: true }).click();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  await page.getByRole('button', { name: '元素', exact: true }).click();
  const count = await page.locator('.node').count();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  assert.equal(await page.locator('.node').count(), count + 1);
  const id = await page.locator('.node-selected').getAttribute('data-id');
  assert.match(id, /^[0-9a-f-]{36}$/);
  await page.locator('.save-state[data-save-status="saved"]').waitFor();
  await page.reload();
  await page.locator('.studio[data-server-state="ready"]').waitFor();
  assert.equal(await page.locator(`[data-id="${id}"]`).count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: 真实 HTTP 非安全上下文下初始化、注册、添加元素、自动保存及重载正常。');
} finally { await browser.close(); }
