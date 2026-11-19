import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

test('接口分别适配不同响应、业务失败不伪装成功，mock 必须显式启用且传递取消', async () => {
  // Execute the shipped implementation with an injected transport, independently of Vite env.
  const compiled = ts.transpileModule(readFileSync('templates/admin/src/services/endpoint.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace("import { request } from './request';", "const request = () => { throw Error('transport must be injected'); };");
  const { defineEndpoint, BusinessError, withMock } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const calls: unknown[] = [];
  const controller = new AbortController();
  const first = defineEndpoint({ id: 'customer.list', request: (value: string) => ({ path: 'customers', options: { params: { keyword: value } } }), adapt: (data: { data: { records: number[]; count: number } }) => ({ items: data.data.records, total: data.data.count }) }, async (path: string, options: unknown) => { calls.push({ path, options }); return { data: { records: [1], count: 1 } }; });
  assert.deepEqual(await first.execute('abc', { signal: controller.signal }), { items: [1], total: 1 });
  assert.deepEqual(calls, [{ path: 'customers', options: { params: { keyword: 'abc' }, signal: controller.signal } }]);
  const second = defineEndpoint({ id: 'order.list', request: () => ({ path: 'orders' }), adapt: (data: { result: number[] }) => ({ items: data.result, total: data.result.length }) }, async () => ({ result: [2, 3] }));
  assert.deepEqual(await second.execute({}), { items: [2, 3], total: 2 });
  let attempts = 0, mocks = 0;
  const failing = defineEndpoint({ id: 'save', request: () => ({ path: 'save', options: { method: 'POST' } }), adapt: (data: unknown) => { throw new BusinessError('审批已结束', data); } }, async () => { attempts++; return { status: 'closed' }; });
  const mock = async () => { mocks++; return 'mock'; };
  await assert.rejects(withMock(failing, mock, false).execute({}), (error: unknown) => error instanceof BusinessError && (error as Error).message === '审批已结束');
  assert.equal(attempts, 1); assert.equal(mocks, 0);
  assert.equal(await withMock(failing, mock, true).execute({}), 'mock');
  controller.abort();
  await assert.rejects(withMock(failing, mock, true).execute({}, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(mocks, 1);
});

test('工程分层检查拒绝反向依赖、跨业务域和绕过 request 的调用', async () => {
  const { checkArchitecture } = await import(pathToFileURL(resolve('templates/admin/scripts/check-architecture.mjs')).href);
  mkdirSync('test-results', { recursive: true });
  const root = mkdtempSync(resolve('test-results/architecture-'));
  for (const directory of ['components', 'modules/orders', 'services']) mkdirSync(resolve(root, 'src', directory), { recursive: true });
  writeFileSync(resolve(root, 'src/components/Valid.ts'), 'export const label = "ok";');
  assert.deepEqual(checkArchitecture(root), []);
  writeFileSync(resolve(root, 'src/components/Bad.ts'), "export { save } from '../services/save';");
  writeFileSync(resolve(root, 'src/modules/orders/Bad.ts'), "import('../customers/internal'); window.fetch('/api/orders');");
  const failures = checkArchitecture(root);
  assert.equal(failures.length, 3);
  assert.match(failures.join('\n'), /components 不能依赖/);
  assert.match(failures.join('\n'), /其他业务域/);
  assert.match(failures.join('\n'), /直接 fetch/);
});
