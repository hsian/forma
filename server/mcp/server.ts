import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PrototypeSource, PrototypeResolver, VersionContext } from './client.js';
import { parsePrototypeLink } from './target.js';
import { functionalAnnotations, functionalNode, nodeReferences, readingGuidance } from './projection.js';

const id = z.string().min(1).max(200);
const paging = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(50).default(20) };
function paginate<T>(items: T[], offset: number, limit: number) {
  return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null };
}

export function createPrototypeMcp(client: PrototypeSource | PrototypeResolver) {
  const dynamic = 'forVersion' in client;
  const guidance = [...readingGuidance, ...(dynamic ? ['先将用户提供的“查看版本”链接传给 resolve_prototype。后续每个工具调用必须携带 prototypeUrl，不保存任何当前项目或版本状态；换项目或版本只需换链接。链接仅用于解析 ID，实际读取的是当前 MCP 服务的数据。'] : [])];
  const server = new McpServer({ name: 'forma-prototype', version: '0.2.0' }, { instructions: guidance.join('\n') });
  function metadata(context: VersionContext, source: PrototypeSource) {
    return { project: context.project, version: context.version, selectedPageId: source.selectedPageId, previewUrl: `${source.binding.url}/preview?${new URLSearchParams({ projectId: context.project.id, versionId: context.version.id, ...(source.selectedPageId ? { pageId: source.selectedPageId } : {}) })}` };
  }
  function tool<S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, run: (input: z.output<z.ZodObject<S>>, context: VersionContext, source: PrototypeSource) => Promise<Record<string, unknown>>) {
    const schema: z.ZodObject<z.ZodRawShape> = z.object({ ...inputSchema, ...(dynamic ? { prototypeUrl: z.string().min(1).max(4096).describe('用户提供的查看版本完整链接，必须包含 projectId 和 versionId；每次查询都传入。') } : {}) });
    server.registerTool<z.ZodRawShape, typeof schema>(name, { description, inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async input => {
      try {
        // Revalidate version existence for every call; never fall back to drafts.
        const target = dynamic ? parsePrototypeLink(String(input.prototypeUrl)) : undefined;
        const source = 'forVersion' in client ? client.forVersion(target!.projectId, target!.versionId, target!.pageId) : client;
        const context = await source.context();
        if (source.selectedPageId) page(context, source.selectedPageId);
        const result = { schemaVersion: '1.0', ...metadata(context, source), ...await run(input as z.output<z.ZodObject<S>>, context, source) };
        const text = JSON.stringify(result);
        if (text.length > 60000) throw Error('结果超过单次读取上限。请缩小 limit、按节点查询，或使用 get_node 的 section=json 和 offset/limit 分段读取。');
        return { content: [{ type: 'text' as const, text }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '原型读取失败' }] };
      }
    });
  }
  function page(context: VersionContext, pageId: string) {
    const value = context.pages.find(page => page.id === pageId);
    if (!value) throw Error('固定版本中没有此页面，请先读取 get_outline');
    return value;
  }
  function selectedPage(pageId: string | undefined, source: PrototypeSource) {
    const selected = pageId ?? source.selectedPageId;
    if (!selected) throw Error('请提供 pageId，或使用包含 pageId 的查看版本链接；可先调用 get_outline 获取页面目录');
    return selected;
  }
  if (dynamic) tool('resolve_prototype', '解析用户提供的查看版本链接，核验项目、固定版本及页面，返回实际读取范围。先调用此工具；后续查询继续携带 prototypeUrl。不会请求链接指向的外部服务器，也不自动选择最新版本。', {}, async (_input, context, source) => ({ guidance, selectedPage: source.selectedPageId ? page(context, source.selectedPageId) : null, pageCount: context.pages.length }));
  tool('get_outline', '读取指定固定版本的页面目录、层级、版本说明和使用边界。先用它定位页面；支持分页。', paging, async ({ offset, limit }, context) => ({
    guidance, pages: paginate(context.pages.map(({ id, name, parentId, position }) => ({ id, name, parentId, position })), offset, limit),
  }));
  tool('get_page', '读取页面功能节点（含隐藏及弹窗内节点）、标注和弹窗目录，省略视觉样式和模拟数据。节点支持分页。未传 pageId 时使用链接中的页面。', { pageId: id.optional(), ...paging }, async ({ pageId, offset, limit }, context, source) => {
    pageId = selectedPage(pageId, source);
    const info = page(context, pageId), doc = await source.document(pageId);
    return { page: info, nodes: paginate(doc.elements.map(functionalNode), offset, limit), dialogs: paginate((doc.dialogs || []).map(({ id, title }) => ({ id, title })), offset, limit), annotations: paginate(functionalAnnotations(doc), offset, limit) };
  });
  tool('get_node', '读取节点、弹窗或标注详情及关联节点。大文本用 section=text；过大功能规格用 section=json 分段读取，此时 offset 为字符位置，limit 每单位代表100字符。表格模拟数据用 section=rows；section=config 逐字段读取。', {
    pageId: id.optional(), nodeId: id, section: z.enum(['detail', 'text', 'rows', 'config', 'json']).default('detail'), ...paging,
  }, async ({ pageId, nodeId, section, offset, limit }, context, source) => {
    pageId = selectedPage(pageId, source);
    page(context, pageId); const doc = await source.document(pageId);
    const element = doc.elements.find(node => node.id === nodeId);
    const dialog = doc.dialogs?.find(node => node.id === nodeId);
    const annotation = functionalAnnotations(doc).find(node => node.id === nodeId);
    if (!element && !dialog && !annotation) throw Error('固定版本页面中没有此节点');
    if (section === 'text' || section === 'json') {
      const text = section === 'json' ? JSON.stringify(element ? functionalNode(element) : annotation ?? { id: dialog!.id, title: dialog!.title }) : element?.text ?? annotation?.content ?? dialog?.title ?? '';
      return { pageId, nodeId, text: text.slice(offset, offset + limit * 100), totalCharacters: text.length, nextOffset: offset + limit * 100 < text.length ? offset + limit * 100 : null };
    }
    if (section === 'rows') {
      if (!element?.table) throw Error('此节点没有配置表格数据');
      return { pageId, nodeId, dataKind: 'mock', rows: paginate(element.table.rows, offset, limit) };
    }
    if (section === 'config') {
      if (!element) throw Error('此节点不是组件');
      const node = functionalNode(element);
      return { pageId, nodeId, fields: paginate(Object.entries(node).map(([key, value]) => ({ key, value })), offset, limit) };
    }
    const references = element ? nodeReferences(element) : [];
    return {
      pageId, node: element ? functionalNode(element) : dialog ? { id: dialog.id, title: dialog.title, kind: 'dialog' } : annotation,
      children: dialog ? paginate(doc.elements.filter(e => e.parentId === dialog.id).map(functionalNode), offset, limit) : undefined,
      references: references.map(id => ({ id, name: doc.elements.find(e => e.id === id)?.name ?? doc.dialogs?.find(d => d.id === id)?.title ?? null })),
    };
  });
  tool('search_prototype', '在指定固定版本中搜索页面名、节点功能配置、弹窗标题和标注。大小写不敏感的字面匹配；返回稳定 ID 和命中片段。按页面批次搜索，继续使用 nextPageOffset；不会搜索图片或模拟数据。', {
    query: z.string().trim().min(1).max(200), pageId: id.optional(), pageOffset: z.number().int().min(0).default(0),
    pageLimit: z.number().int().min(1).max(10).default(5), ...paging,
  }, async ({ query, pageId, pageOffset, pageLimit, offset, limit }, context, source) => {
    const pages = pageId ? [page(context, pageId)] : context.pages;
    const selected = pages.slice(pageOffset, pageOffset + pageLimit);
    const hits: { pageId: string; pageName: string; nodeId: string | null; kind: string; snippet: string }[] = [];
    const needle = query.toLocaleLowerCase();
    function match(pageId: string, pageName: string, nodeId: string | null, kind: string, value: unknown) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      const index = text.toLocaleLowerCase().indexOf(needle);
      if (index >= 0) hits.push({ pageId, pageName, nodeId, kind, snippet: text.slice(Math.max(0, index - 60), index + needle.length + 180) });
    }
    for (const item of selected) {
      match(item.id, item.name, null, 'page', item.name);
      const doc = await source.document(item.id);
      for (const e of doc.elements) match(item.id, item.name, e.id, e.kind, functionalNode(e));
      for (const d of doc.dialogs || []) match(item.id, item.name, d.id, 'dialog', d.title);
      for (const a of functionalAnnotations(doc)) match(item.id, item.name, a.id, 'annotation', a);
    }
    return { query, matches: paginate(hits, offset, limit), scannedPageIds: selected.map(p => p.id), totalPages: pages.length, nextPageOffset: pageOffset + pageLimit < pages.length ? pageOffset + pageLimit : null };
  });
  return server;
}
