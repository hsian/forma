import { accountSelectDocument } from '../examples/account-select';
import { documentSchema } from '../server/document-validation';
import { randomUUID } from 'node:crypto';

// 本次交付的一次性数据写入脚本；没有添加产品导入入口或启动时植入逻辑。
const base = process.env.TEST_URL || 'http://127.0.0.1:3000';
const projectId = process.argv[2];
if (!projectId) throw Error('请明确指定已有项目 ID');
const cookie = process.env.FORMA_SESSION_COOKIE;
if (!cookie) throw Error('请先登录，并通过 FORMA_SESSION_COOKIE 提供本次操作的登录 Cookie');
const clientId = randomUUID();
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie!, 'X-Forma-Client-Id': clientId }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result;
}
const document = documentSchema.parse(accountSelectDocument());
const { pages } = await request(`/api/projects/${encodeURIComponent(projectId)}/pages`);
if (pages.some((page: { name: string }) => page.name === '账套选择')) throw Error('项目已有同名页面，停止写入以保留现有内容');
const page = await request(`/api/projects/${encodeURIComponent(projectId)}/pages`, 'POST', { name: '账套选择' });
await request(`/api/pages/${page.id}/lease`, 'POST');
try {
  const saved = await request(`/api/pages/${page.id}/document`, 'PUT', { revision: 0, document });
  console.log(JSON.stringify({ pageId: page.id, name: page.name, projectId, revision: saved.revision, elements: document.elements.length }));
} finally { await request(`/api/pages/${page.id}/lease`, 'DELETE'); }
