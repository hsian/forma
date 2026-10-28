import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, List, Space, Tag } from 'antd';
import type { DocumentSession } from './useDocumentSession';
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
  function preview(version: Version) {
    const query = new URLSearchParams({ projectId: session.currentProjectId, versionId: version.id, pageId: session.currentPageId });
    window.open(`/preview?${query}`, '_blank', 'noopener');
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
        <div className="version-card-heading"><strong title={version.name}>{version.name}</strong><Tag>已固定</Tag></div>
        <div className="version-card-meta"><span title={version.createdBy}>{version.createdBy}</span><time dateTime={new Date(version.createdAt).toISOString()}>{new Date(version.createdAt).toLocaleString()}</time></div>
        {version.description && <p className="version-card-description">{version.description}</p>}
        <div className="version-card-actions"><Button size="small" onClick={() => preview(version)}>查看版本</Button><Button size="small" loading={exporting === version.id} disabled={!!exporting && exporting !== version.id} onClick={() => { void exportHtml(version); }}>导出 HTML</Button>{session.can('version.copy') && session.canCreateProject && <Button size="small" onClick={() => copy(version)}>新建草稿</Button>}{session.can('version.delete') && <Button type="text" size="small" danger onClick={() => remove(version)}>删除</Button>}</div>
      </List.Item>}/>
  </div>;
}
