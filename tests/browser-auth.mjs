import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Authenticate through the public API in each isolated test server; production has no bypass.
export async function authenticatedPage(browser, options = {}) {
  if (!process.env.TEST_URL) throw Error('必须使用隔离测试服务器');
  const context = await browser.newContext();
  const status = (await (await context.request.get(`${process.env.TEST_URL}/api/auth/status`)).json());
  const response = await context.request.post(`${process.env.TEST_URL}/api/auth/${status.setupRequired ? 'setup' : 'login'}`, { data: { username: 'qa-admin', password: 'qa-password-123' } });
  assert.equal(response.ok(), true, await response.text());
  const page = await context.newPage();
  if (options.viewport) await page.setViewportSize(options.viewport);
  let client = randomUUID(); let loaded = false;
  page.on('request', request => { const id = request.headers()['x-forma-client-id']; if (id) { client = id; loaded = true; } });
  const original = page.request;
  Object.defineProperty(page, 'request', { value: new Proxy(original, { get(target, key) {
    if (['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'].includes(String(key))) return async (url, init = {}) => {
      const method = key === 'fetch' ? (init.method || 'GET').toLowerCase() : key;
      const headers = { ...init.headers, 'x-forma-client-id': client };
      // Document fixtures must obtain the same server-side editing right as real clients.
      if (method === 'put' && /\/api\/pages\/[^/]+\/document$/.test(url)) {
        const lease = await original.post(url.replace(/\/document$/, '/lease'), { headers });
        assert.equal(lease.ok(), true, await lease.text());
      }
      const response = await target[key](url, { ...init, headers });
      if (!loaded && method === 'put' && /\/api\/pages\/[^/]+\/document$/.test(url)) await original.delete(url.replace(/\/document$/, '/lease'), { headers });
      return response;
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } }) });
  return page;
}
