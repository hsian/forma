import { useEffect, useState } from 'react';
import { Alert, App, Button, Dropdown, Input, List, Space, Tag } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import type { DocumentSession } from './useDocumentSession';
import { McpConnection } from './McpConnection';
type Version = { id: string; name: string; description: string; createdBy: string; createdAt: number };
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.message || '版本操作失败'); return result;
}
export function VersionManager({ session }: { session: DocumentSession }) {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]), [error, setError] = useState('');
  const [draft, setDraft] = useState<{ stamp: string; pages: number }>();
  const [exporting, setExporting] = useState<string | null>(null);
  const [mcpVersion, setMcpVersion] = useState<Version | null>(null);
  const [name, setName] = useState(''), [description, setDescription] = useState('');
  const root = `/api/projects/${encodeURIComponent(session.currentProjectId)}/versions`;
  async function refresh() { const result = await api<{ versions: Version[] }>(root); setVersions(result.versions); }
  useEffect(() => { void refresh().catch(error => setError(error.message)); }, [session.currentProjectId]);
  async function prepare() {
    setBusy(true); setError('');
    try { if (!await session.flush()) throw Error('请先处理当前页面的保存失败或冲突'); setDraft(await api(root + '/draft')); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function create() {
    if (!draft || !name.trim()) return;
    setBusy(true); setError('');
    try {
      if (!await session.flush()) throw Error('请先处理当前页面的保存失败或冲突');
      const result = await api<{ newPages: number; reusedPages: number; newBytes: number }>(root, 'POST', { name: name.trim(), description, stamp: draft.stamp });
      await refresh(); setDraft(undefined); setName(''); setDescription('');
      void message.success(`版本已固定：新增 ${result.newPages} 页内容，复用 ${result.reusedPages} 页，新增内容 ${(result.newBytes / 1024).toFixed(1)} KB`);
    } catch (error) { setError((error as Error).message); setDraft(undefined); } finally { setBusy(false); }
  }
  function previewUrl(version: Version) {
    const query = new URLSearchParams({ projectId: session.currentProjectId, versionId: version.id, pageId: session.currentPageId });
    return `/preview?${query}`;
  }
  function preview(version: Version) {
    window.open(previewUrl(version), '_blank', 'noopener');
  }
  async function exportHtml(version: Version) {
    if (exporting) return;
    setExporting(version.id); setError('');
    try {
      const response = await fetch(`${root}/${encodeURIComponent(version.id)}/export.html`);
      if (!response.ok) { const error = await response.json(); throw Error(error.message || '导出失败'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url;
      const filename = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('Content-Disposition') || '')?.[1];
      link.download = filename ? decodeURIComponent(filename) : `${session.projectName}-${version.name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160) + '.html';
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { setError(error instanceof Error ? error.message : '导出失败'); }
    finally { setExporting(null); }
  }
  function copy(version: Version) {
    modal.confirm({ title: `基于「${version.name}」新建草稿项目？`, content: '完整复制该版本的页面树和内容，当前项目和已确认版本都会保留。', okText: '新建草稿项目', cancelText: '取消', onOk: async () => {
      if (!await session.flush()) throw Error('请先处理当前页面未保存的修改');
      const result = await api<{ page: { id: string } }>(`${root}/${version.id}/copy`, 'POST');
      await session.switchPage(result.page.id);
    } });
  }
  function remove(version: Version) {
    modal.confirm({ title: `删除版本「${version.name}」？`, content: '此版本的预览链接将失效。工作草稿和其他版本保留，只清理不再被任何版本引用的内容。', okText: '删除版本', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { await api(`${root}/${version.id}`, 'DELETE'); await refresh(); } });
  }
  return <div className="version-panel"><h3>项目迭代版本</h3><div className="version-project-name">{session.projectName}</div>
      <p className="property-note">确认版本后，后续草稿修改不会改变历史页面、页面树和固定预览链接。</p>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }}/>}
      {session.can('version.publish') && <div className="version-create">{draft ? <><Alert type="info" message={`已读取 ${draft.pages} 个页面。确认时会核对项目是否又被更新。`}/><label className="stacked-label">版本名称<Input aria-label="迭代版本名称" maxLength={120} placeholder="例如 V1.0 / 十月迭代" value={name} onChange={event => setName(event.target.value)}/></label><label className="stacked-label">版本说明<Input.TextArea aria-label="迭代版本说明" maxLength={5000} value={description} onChange={event => setDescription(event.target.value)}/></label><Space style={{ marginTop: 14 }}><Button type="primary" disabled={!name.trim()} loading={busy} onClick={() => { void create(); }}>确认固定版本</Button><Button disabled={busy} onClick={() => setDraft(undefined)}>取消</Button></Space></> : <Button type="primary" loading={busy} onClick={() => { void prepare(); }}>确认新的迭代版本</Button>}</div>}
      <List className="version-list" split={false} locale={{ emptyText: '尚未确认迭代版本' }} dataSource={versions} renderItem={version => <List.Item className="version-card">
        <div className="version-card-heading"><a className="version-card-title" title={version.name} href={previewUrl(version)} target="_blank" rel="noopener noreferrer">{version.name}</a><Tag>已固定</Tag><Dropdown trigger={['click']} placement="bottomRight" menu={{ items: [
          { key: 'preview', label: '查看版本', onClick: () => preview(version) },
          { key: 'mcp', label: '接入 MCP', onClick: () => setMcpVersion(version) },
          { key: 'export', label: exporting === version.id ? '正在导出…' : '导出 HTML', disabled: !!exporting, onClick: () => { void exportHtml(version); } },
          ...(session.can('version.copy') && session.canCreateProject ? [{ key: 'copy', label: '新建草稿', onClick: () => copy(version) }] : []),
          ...(session.can('version.delete') ? [{ type: 'divider' as const }, { key: 'delete', label: '删除', danger: true, onClick: () => remove(version) }] : []),
        ] }}><Button className="version-card-more" type="text" size="small" aria-label={`${version.name} 的更多操作`} icon={<MoreOutlined />} loading={exporting === version.id} /></Dropdown></div>
        <div className="version-card-meta"><span title={version.createdBy}>{version.createdBy}</span><time dateTime={new Date(version.createdAt).toISOString()}>{new Date(version.createdAt).toLocaleString()}</time></div>
        {version.description && <p className="version-card-description">{version.description}</p>}
      </List.Item>}/>
      {mcpVersion && <McpConnection key={session.currentProjectId + mcpVersion.id} projectId={session.currentProjectId} version={mcpVersion} onClose={() => setMcpVersion(null)} />}
  </div>;
}
