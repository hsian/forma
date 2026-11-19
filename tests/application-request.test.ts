import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequest, HttpError } from '../templates/runtime/request';

test('统一请求支持参数、JSON、上传、下载、错误与取消，且不重试写请求', async () => {
  let writes = 0;
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/error')) { writes++; res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: '登录已失效' })); return; }
    if (req.url === '/api/slow') { setTimeout(() => res.end('{}'), 150); return; }
    if (req.url === '/api/empty') { res.writeHead(204).end(); return; }
    if (req.url === '/api/file') { res.end('download-content'); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: req.url, method: req.method, authorization: req.headers.authorization, contentType: req.headers['content-type'], body }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let unauthorized = 0;
  const request = createRequest({ baseURL: `http://127.0.0.1:${address.port}/api`, getToken: () => 'business-token', onUnauthorized: () => { unauthorized++; } });
  try {
    const result = await request<{ url: string; body: string; authorization: string; contentType: string }>('customers', { method: 'POST', params: { keyword: '中文', page: 2, skipped: undefined }, body: { name: '客户' } });
    assert.equal(result.url, '/api/customers?keyword=%E4%B8%AD%E6%96%87&page=2');
    assert.equal(result.authorization, 'Bearer business-token');
    assert.equal(result.contentType, 'application/json');
    assert.deepEqual(JSON.parse(result.body), { name: '客户' });
    const form = new FormData(); form.set('name', '上传');
    const upload = await request<{ contentType: string; body: string }>('upload', { method: 'POST', body: form });
    assert.match(upload.contentType, /multipart\/form-data; boundary=/);
    assert.match(upload.body, /上传/);
    assert.equal(await request('empty'), undefined);
    assert.equal(await (await request<Blob>('file', { responseType: 'blob' })).text(), 'download-content');
    await assert.rejects(request('error', { method: 'POST', body: {} }), error => error instanceof HttpError && error.status === 401 && error.message === '登录已失效');
    assert.equal(unauthorized, 1); assert.equal(writes, 1);
    await assert.rejects(request('slow', { timeout: 15 }), error => (error as Error).name === 'TimeoutError');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(request('slow', { signal: controller.signal }), error => (error as Error).name === 'AbortError');
    await assert.rejects(request('https://other.example/api'), /接口路径/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
