import { accountSelectDocument } from '../examples/account-select';
import { documentSchema } from '../server/document-validation';

// 本次交付的一次性数据写入脚本；没有添加产品导入入口或启动时植入逻辑。
const base = process.env.TEST_URL || 'http://127.0.0.1:3000';
const projectId = process.argv[2];
if (!projectId) throw Error('请明确指定已有项目 ID');
async function request(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result;
}
const document = documentSchema.parse(accountSelectDocument());
const { pages } = await request(`/api/projects/${encodeURIComponent(projectId)}/pages`);
if (pages.some((page: { name: string }) => page.name === '账套选择')) throw Error('项目已有同名页面，停止写入以保留现有内容');
const page = await request(`/api/projects/${encodeURIComponent(projectId)}/pages`, 'POST', { name: '账套选择' });
const saved = await request(`/api/pages/${page.id}/document`, 'PUT', { revision: 0, document });
console.log(JSON.stringify({ pageId: page.id, name: page.name, projectId, revision: saved.revision, elements: document.elements.length }));
