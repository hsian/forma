import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Empty, Select, Spin } from 'antd';
import { PictureOutlined, UploadOutlined } from '@ant-design/icons';
import { useManager } from './ProjectManager';
import { DesignCanvas } from './DesignCanvas';
import { DesignAiPanel } from './DesignAiPanel';
import { ImportReport } from './ImportReport';
import type { DesignBoardInfo } from '../shared/projects';
import type { PrototypeDocument } from '../shared/model';
import './page-design.css';

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || '加载设计稿失败');
  return result;
}

export function PageDesignSurface({ children }: { children: ReactNode }) {
  const { pages, session, busy, designView, showDesign, showPrototype, uploadDesign } = useManager();
  const current = pages.find(page => page.id === session.currentPageId);
  const enabled = !!current?.uiDesignRequired;
  return <>
    {enabled && <div className="page-delivery-tabs" role="tablist" aria-label="页面交付物">
      <button role="tab" aria-selected={!designView} onClick={showPrototype}>原型</button>
      <button role="tab" aria-selected={designView} disabled={busy} onClick={() => showDesign(session.currentPageId)}><PictureOutlined/> UI 设计稿{current?.uiDesignCount ? ` · ${current.uiDesignCount}` : <span className="design-pending-label">待设计</span>}</button>
    </div>}
    <div className="prototype-surface" hidden={designView} inert={designView}>{children}</div>
    {designView && enabled && <DesignViewer key={`${session.currentPageId}:${current?.uiDesignCount}`} pageId={session.currentPageId} pageName={session.pageName} canUpload={session.can('sketch.import')} busy={busy} onUpload={uploadDesign}/>}
  </>;
}

function DesignViewer({ pageId, pageName, canUpload, busy, onUpload }: { pageId: string; pageName: string; canUpload: boolean; busy: boolean; onUpload: () => void }) {
  const [boards, setBoards] = useState<DesignBoardInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [doc, setDoc] = useState<PrototypeDocument>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [aiVisible, setAiVisible] = useState(false);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.ctrlKey && !event.altKey && !event.metaKey && (event.code === 'Backquote' || event.key === '`' || event.key === '~')) {
        event.preventDefault(); if (!event.repeat && !event.isComposing) setAiVisible(value => !value);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void get<{ boards: DesignBoardInfo[] }>(`/api/pages/${encodeURIComponent(pageId)}/design`, controller.signal)
      .then(result => { setBoards(result.boards); setSelectedId(result.boards[0]?.id || ''); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pageId, attempt]);
  useEffect(() => {
    setDoc(undefined); setReportOpen(false); setSelectedIds([]);
    if (!selectedId) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void get<{ document: PrototypeDocument }>(`/api/pages/${encodeURIComponent(pageId)}/design/${encodeURIComponent(selectedId)}`, controller.signal)
      .then(result => { setDoc(result.document); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pageId, selectedId, attempt]);
  const selected = boards.find(board => board.id === selectedId);
  return <div className="ui-design-viewer">
    <div className="canvas-ruler ui-design-heading"><strong className="ui-design-page-title" title={pageName}>{pageName}</strong><span className="ui-design-upload-time">{selected ? `上传于 ${new Date(selected.createdAt).toLocaleString('zh-CN')}` : 'UI 设计稿'}</span>
      {!!boards.length && <Select size="small" variant="borderless" className="ui-design-board-select" aria-label="查看设计画板" value={selectedId || undefined} options={boards.map(board => ({ value: board.id, label: board.name }))} onChange={setSelectedId}/>}
      {doc?.importInfo && <Button type="text" size="small" onClick={() => setReportOpen(value => !value)}>{reportOpen ? '收起导入报告' : '查看导入报告'}</Button>}
      {canUpload && <Button type="text" size="small" aria-label={boards.length ? '上传更多设计稿' : '上传 Sketch'} icon={<UploadOutlined/>} disabled={busy} onClick={onUpload}>{boards.length ? '上传更多设计稿' : '上传 Sketch'}</Button>}
    </div>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>}/>}
    {reportOpen && doc?.importInfo && <div className="ui-design-report"><ImportReport report={doc.importInfo.report}/></div>}
    {loading ? <div className="ui-design-empty"><Spin tip="正在加载设计稿…"><div style={{width:160,height:80}}/></Spin></div> : !boards.length && !error ? <div className="ui-design-empty"><div className="ui-design-empty-icon"><PictureOutlined/></div><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>等待 UI 设计</strong><p>此页面需要 UI 设计，可上传 Sketch 画板关联到当前页面。</p></>}/>{canUpload && <Button type="primary" aria-label="上传 Sketch" icon={<UploadOutlined/>} disabled={busy} onClick={onUpload}>上传 Sketch</Button>}</div> : doc && <DesignCanvas key={`canvas:${selectedId}`} doc={doc} name={selected?.name} selectedIds={selectedIds} onSelect={setSelectedIds}/>}
    {doc && selectedId && <DesignAiPanel key={`ai:${selectedId}`} pageId={pageId} designId={selectedId} name={selected?.name || pageName} doc={doc} selectedIds={selectedIds} visible={aiVisible} onClose={() => setAiVisible(false)}/>}
  </div>;
}
