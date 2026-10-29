import type { PageInfo, ProjectInfo } from '../../shared/projects.js';
import type { PrototypeDocument } from '../../shared/model.js';

export interface PrototypeBinding { url: string; projectId: string; versionId: string }
export interface VersionContext {
  project: ProjectInfo;
  version: { id: string; name: string; description: string; createdAt: number };
  pages: PageInfo[];
}
export interface PrototypeSource {
  binding: { url: string };
  selectedPageId?: string;
  context(): Promise<VersionContext>;
  document(pageId: string): Promise<PrototypeDocument>;
}
export interface PrototypeResolver { forVersion(projectId: string, versionId: string, pageId?: string): PrototypeSource }

export function bindingFromEnv(env: NodeJS.ProcessEnv): PrototypeBinding {
  const required = (key: string) => { const value = env[key]; if (!value) throw Error(`缺少环境变量 ${key}`); return value; };
  const url = new URL(required('FORMA_URL'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('FORMA_URL 必须是服务根地址，例如 http://127.0.0.1:6060');
  return { url: url.origin, projectId: required('FORMA_PROJECT_ID'), versionId: required('FORMA_VERSION_ID') };
}

/** Uses only anonymous, read-only fixed-version endpoints; never reads drafts. */
export class PrototypeClient {
  readonly root: string;
  constructor(readonly binding: PrototypeBinding, private fetcher: typeof fetch = fetch) {
    this.root = `/api/mcp/projects/${encodeURIComponent(binding.projectId)}/versions/${encodeURIComponent(binding.versionId)}`;
  }
  private async read<T>(path: string): Promise<T> {
    const response = await this.fetcher(this.binding.url + path, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      const messages: Record<number, string> = { 401: '原型服务尚未支持免鉴权 MCP，请更新并重启服务', 404: '绑定的版本或页面不存在或已删除；不会切换到草稿或其他版本' };
      throw Error(messages[response.status] || `读取原型失败（${response.status}）`);
    }
    return await response.json() as T;
  }
  context() { return this.read<VersionContext>(this.root); }
  async document(pageId: string) {
    return (await this.read<{ document: PrototypeDocument }>(`${this.root}/pages/${encodeURIComponent(pageId)}`)).document;
  }
}
