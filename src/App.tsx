import { useEffect, useRef, useState, useLayoutEffect, type CSSProperties, type PointerEvent } from 'react';
import { App as AntApp, Button, Input, InputNumber, Select, Slider, Tooltip, Modal, Switch } from 'antd';
import { AppstoreOutlined, BorderOutlined, CopyOutlined, DeleteOutlined, DownOutlined, EyeInvisibleOutlined, EyeOutlined, FontSizeOutlined, HolderOutlined, LayoutOutlined, LockOutlined, MinusOutlined, PlusOutlined, RedoOutlined, SearchOutlined, TableOutlined, UndoOutlined, UnlockOutlined, PlayCircleOutlined, AimOutlined, DragOutlined, InfoCircleOutlined, CloseOutlined } from '@ant-design/icons';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ElementView } from './ElementView';
import { SelectProperties } from './SelectProperties';
import { ComponentProperties, ConditionProperties } from './ComponentProperties';
import { initialValues } from '../shared/runtime';
import { ProjectManagerProvider, PageTree } from './ProjectManager';
import { useDocumentSession, saveLabels } from './useDocumentSession';
import { useEditor } from './store';
import { kindNames, makeElement, makeDialog, type ElementKind, type PrototypeElement, type PrototypeDialog, type Action } from '../shared/model';

const kinds: ElementKind[] = ['rectangle', 'ellipse', 'text', 'line', 'button', 'input', 'select', 'switch', 'table', 'tabs', 'tree', 'checkbox'];
const symbols: Record<ElementKind, React.ReactNode> = { rectangle: <BorderOutlined />, ellipse: <span className="ellipse-icon" />, text: <FontSizeOutlined />, line: <MinusOutlined />, button: <span className="button-icon">按钮</span>, input: <span className="input-icon">I</span>, select: <span className="select-icon"><span>请选择</span><DownOutlined/></span>, switch: <span className="switch-icon" />, table: <TableOutlined />, tabs: <span>Tabs</span>, tree: <span>Tree</span>, checkbox: <span>☑</span> };
function elementStyle(e: PrototypeElement): CSSProperties { return { position: 'absolute', left: e.x, top: e.y, width: e.width, height: e.height, transform: `rotate(${e.rotation}deg)`, opacity: e.opacity }; }
function Tool({ title, children, onClick, disabled = false, active = false }: { title: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean }) { return <Tooltip title={title}><button aria-label={title} className={`tool ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>{children}</button></Tooltip>; }

export default function App() {
  const { message, modal } = AntApp.useApp();
  const { doc, selected, past, future, select, commit, patch, undo, redo } = useEditor();
  const [tab, setTab] = useState<'pages' | 'elements' | 'layers'>('pages');
  const [propTab, setPropTab] = useState<'design' | 'interaction'>('design');
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(0.8);
  const [openingPreview, setOpeningPreview] = useState(false);
  const previewOpening = useRef(false);
  const [hand, setHand] = useState(false);
  const [space, setSpace] = useState(false);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [draggingView, setDraggingView] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const session = useDocumentSession();
  const { server, saveStatus, saveError, pageName, retry, flush, reload, currentPageId, currentProjectId } = session;
  const [help, setHelp] = useState(false);
  const [managing, setManaging] = useState(false);
  const [editingDialogId, setEditingDialogId] = useState<string | null>(null);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const moveable = useRef<Moveable>(null);
  const clipboard = useRef<PrototypeElement[]>([]);
  const pan = useRef<{ x: number; y: number; offsetX: number; offsetY: number; pointerId: number } | null>(null);

  useEffect(() => { setEditingDialogId(null); setEditing(null); }, [currentPageId]);
  const editingDialog = doc.dialogs?.find(dialog => dialog.id === editingDialogId);
  const surface = editingDialog || doc;
  const sceneWidth = Math.max(doc.width, editingDialog ? editingDialog.width + 128 : 0);
  const sceneHeight = Math.max(doc.height, editingDialog ? editingDialog.height + 200 : 0);
  const elements = doc.elements.filter(e => e.parentId === editingDialog?.id);
  const pageElements = doc.elements.filter(e => !e.parentId);

  const active = elements.find(e => e.id === selected[0]);
  const editable = selected.map(id => elements.find(e => e.id === id)).filter((e): e is PrototypeElement => !!e && !e.locked);
  useLayoutEffect(() => { setTargets(selected.map(id => page.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)).filter((e): e is HTMLElement => !!e && e.dataset.locked !== 'true')); }, [selected, doc]);
  useEffect(() => { moveable.current?.updateRect(); }, [zoom, doc, viewOffset]);
  useEffect(() => { if (server === 'ready') fit(); }, [server, currentPageId, editingDialogId]);
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setZoom(z => Math.min(2, Math.max(.1, z - e.deltaY * .001)));
      else {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.clientHeight : 1;
        setViewOffset(old => ({ x: old.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, y: old.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit }));
      }
    };
    v.addEventListener('wheel', wheel, { passive: false });
    return () => v.removeEventListener('wheel', wheel);
  }, []);
  function add(kind: ElementKind, x = 24, y = 24) { const e = { ...makeElement(kind, Math.round(x), Math.round(y)), parentId: editingDialog?.id }; commit(d => { d.elements.push(e); }); select([e.id]); }
  function remove() { commit(d => { d.elements = d.elements.filter(e => !selected.includes(e.id) || e.locked); }); select([]); }
  function copy() { clipboard.current = structuredClone(elements.filter(e => selected.includes(e.id))); }
  function paste() { const copies = clipboard.current.map(e => ({ ...structuredClone(e), id: crypto.randomUUID(), x: e.x + 24, y: e.y + 24, locked: false, parentId: editingDialog?.id, name: `${e.name} 副本` })); if (!copies.length) return; commit(d => { d.elements.push(...copies); }); select(copies.map(e => e.id)); clipboard.current = copies; }
  function duplicate() { copy(); paste(); }
  function align(mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    if (!editable.length) return;
    const minX = Math.min(...editable.map(e => e.x)), maxX = Math.max(...editable.map(e => e.x + e.width));
    const minY = Math.min(...editable.map(e => e.y)), maxY = Math.max(...editable.map(e => e.y + e.height));
    commit(d => { d.elements.forEach(e => { if (!editable.some(item => item.id === e.id)) return; if (mode === 'left') e.x = editable.length === 1 ? 0 : minX; if (mode === 'right') e.x = (editable.length === 1 ? surface.width : maxX) - e.width; if (mode === 'center') e.x = editable.length === 1 ? (surface.width - e.width) / 2 : (minX + maxX - e.width) / 2; if (mode === 'top') e.y = editable.length === 1 ? 0 : minY; if (mode === 'bottom') e.y = (editable.length === 1 ? surface.height : maxY) - e.height; if (mode === 'middle') e.y = editable.length === 1 ? (surface.height - e.height) / 2 : (minY + maxY - e.height) / 2; }); });
  }
  function reorder(id: string, direction: 'front' | 'back' | 'up' | 'down') {
    commit(d => {
      const siblings = d.elements.filter(e => e.parentId === editingDialog?.id);
      const index = siblings.findIndex(e => e.id === id);
      if (index < 0) return;
      const [item] = siblings.splice(index, 1);
      const next = direction === 'front' ? siblings.length : direction === 'back' ? 0 : direction === 'up' ? Math.min(index + 1, siblings.length) : Math.max(index - 1, 0);
      siblings.splice(next, 0, item);
      let cursor = 0;
      d.elements = d.elements.map(e => e.parentId === editingDialog?.id ? siblings[cursor++] : e);
    });
  }
  function patchSurface(patch: Partial<Pick<PrototypeDialog, 'width' | 'height' | 'background' | 'title'>>) {
    commit(d => { const target = editingDialog ? d.dialogs?.find(dialog => dialog.id === editingDialog.id) : d; if (target) Object.assign(target, patch); });
  }
  function enterDialog(id: string) { setTab('elements'); setSearch(''); setEditingDialogId(id); select([]); setEditing(null); setPropTab('design'); setHand(false); }
  function leaveDialog() { setEditingDialogId(null); select([]); setEditing(null); }
  function createDialog() {
    const created = makeDialog('新建弹窗 ' + ((doc.dialogs?.length || 0) + 1));
    commit(d => { (d.dialogs ||= []).push(created.dialog); d.elements.push(...created.elements); });
    enterDialog(created.dialog.id);
  }
  function ensureDialog(element: PrototypeElement): string {
    if (element.modalId && doc.dialogs?.some(dialog => dialog.id === element.modalId)) return element.modalId;
    const created = makeDialog(element.actionText === '操作成功' ? '新建弹窗' : element.actionText || element.text);
    commit(d => {
      (d.dialogs ||= []).push(created.dialog); d.elements.push(...created.elements);
      const target = d.elements.find(e => e.id === element.id);
      if (target) Object.assign(target, { modalId: created.dialog.id, action: 'modal', actionText: created.dialog.title });
    });
    return created.dialog.id;
  }
  function setAction(element: PrototypeElement, action: Action) {
    if (action === 'modal') { ensureDialog(element); if (element.action !== 'modal') patch(element.id, { action }); }
    else patch(element.id, { action });
  }
  function updateActionText(element: PrototypeElement, text: string) {
    commit(d => { const target = d.elements.find(e => e.id === element.id); if (target) target.actionText = text;
      if (element.action === 'modal') { const dialog = d.dialogs?.find(item => item.id === element.modalId); if (dialog) dialog.title = text; }
    });
  }
  useEffect(() => { if (editingDialogId && !editingDialog) leaveDialog(); }, [editingDialogId, editingDialog]);
  function fit() { const v = viewport.current; if (!v) return; endPan(); setViewOffset({ x: 0, y: 0 }); setZoom(Math.min(1, Math.max(.1, Math.min((v.clientWidth - 120) / sceneWidth, (v.clientHeight - 120) / sceneHeight)))); requestAnimationFrame(() => { v.scrollTop = 0; v.scrollLeft = 0; }); }
  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (!(event.button === 1 || event.button === 0 && (hand || space))) return;
    event.preventDefault(); event.stopPropagation();
    pan.current = { x: event.clientX, y: event.clientY, offsetX: viewOffset.x, offsetY: viewOffset.y, pointerId: event.pointerId };
    setDraggingView(true); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const start = pan.current;
    if (start?.pointerId === event.pointerId) setViewOffset({ x: start.offsetX + event.clientX - start.x, y: start.offsetY + event.clientY - start.y });
  }
  function endPan() {
    const start = pan.current; pan.current = null; setDraggingView(false);
    if (start && viewport.current?.hasPointerCapture(start.pointerId)) viewport.current.releasePointerCapture(start.pointerId);
  }
  async function startPreview() {
    if (previewOpening.current || !currentPageId || !currentProjectId) return;
    const popup = window.open('about:blank', '_blank');
    if (!popup) { void message.warning('请允许此站点打开新标签页后重试预览'); return; }
    popup.opener = null;
    popup.document.title = '正在打开原型预览';
    popup.document.body.textContent = '正在保存并打开原型预览…';
    previewOpening.current = true; setOpeningPreview(true);
    try {
      if (!await flush()) { popup.close(); void message.warning('当前修改尚未保存，请先处理保存失败或冲突后再预览'); return; }
      const query = new URLSearchParams({ projectId: currentProjectId, pageId: currentPageId });
      if (editingDialogId) query.set('dialogId', editingDialogId);
      if (!popup.closed) popup.location.replace(`/preview?${query}`);
    } catch {
      popup.close(); void message.error('无法打开预览，请稍后重试');
    } finally { previewOpening.current = false; setOpeningPreview(false); }
  }
  useEffect(() => {
    function keyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flush(); return; }
      if (server !== 'ready' || managing || openingPreview) return;
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"],.ant-select')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl && e.key.toLowerCase() === 'v') setHand(false);
      if (e.code === 'Space') { e.preventDefault(); setSpace(true); }
      if (e.key === 'Escape') { select([]); setEditing(null); }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); select(elements.filter(e => !e.locked && !e.hidden).map(e => e.id)); }
      if (ctrl && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(); }
      if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); }
      if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; commit(d => d.elements.forEach(el => { if (!selected.includes(el.id) || el.locked) return; el.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0; el.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0; })); }
    }
    const keyUp = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    const blur = () => { setSpace(false); endPan(); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); };
  });
  const numeric = (label: string, key: 'x' | 'y' | 'width' | 'height' | 'rotation' | 'fontSize' | 'radius' | 'strokeWidth', min?: number) => <label className={key === 'fontSize' || key === 'strokeWidth' ? 'numeric appearance-numeric' : 'numeric'}><span>{label}</span><InputNumber aria-label={label} value={active ? Math.round(active[key] * 100) / 100 : 0} min={min} controls={false} onChange={value => { if (active && value !== null) patch(active.id, { [key]: value }); }} /></label>;
  const color = (label: string, key: 'fill' | 'color' | 'stroke') => active && <label className="color-field"><span>{label}</span><div><input aria-label={label} type="color" value={active[key]} onChange={e => patch(active.id, { [key]: e.target.value })} /><span>{active[key].toUpperCase()}</span></div></label>;
  const disabled = active?.locked;
  const canvas = (<div ref={page} className="artboard" style={{ width: surface.width, height: surface.height, background: surface.background, transform: editingDialog ? undefined : `scale(${zoom})`, position: editingDialog ? 'relative' : 'absolute' }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const kind = e.dataTransfer.getData('application/forma-element') as ElementKind; if (!kinds.includes(kind)) return; const rect = e.currentTarget.getBoundingClientRect(); add(kind, Math.max(0, (e.clientX - rect.left) / zoom), Math.max(0, (e.clientY - rect.top) / zoom)); }}>
          {elements.filter(e => !e.hidden).map(e => <div key={e.id} data-id={e.id} data-locked={e.locked} className={`node ${selected.includes(e.id) ? 'node-selected' : ''} ${e.locked ? 'node-locked' : ''}`} style={elementStyle(e)} onMouseDown={event => { if (hand || space || pan.current || event.button !== 0 || editing === e.id) return; event.stopPropagation(); if (event.shiftKey) select(selected.includes(e.id) ? selected.filter(id => id !== e.id) : [...selected, e.id]); else if (!selected.includes(e.id)) { select([e.id]); if (!e.locked) { const inputEvent = event.nativeEvent; void moveable.current?.waitToChangeTarget().then(() => moveable.current?.dragStart(inputEvent)); } } }} onDoubleClick={() => { if (e.kind === 'text' && !e.locked) setEditing(e.id); }}><div className="node-content"><ElementView element={e} values={initialValues(doc)}/></div>{editing === e.id && <Input.TextArea autoFocus defaultValue={e.text} className="inline-text" style={{ fontSize: e.fontSize }} onBlur={event => { patch(e.id, { text: event.target.value }); setEditing(null); }} onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.blur(); }} />}</div>)}
          <Moveable ref={moveable} target={targets} draggable={!hand && !space && !editing} resizable={!hand && !space && !editing} rotatable={!hand && !space && !editing} origin={false} zoom={1 / zoom} snappable snapGridWidth={8} snapGridHeight={8} isDisplayGridGuidelines={false} snapThreshold={6} verticalGuidelines={[0, surface.width / 2, surface.width]} horizontalGuidelines={[0, surface.height / 2, surface.height]} elementGuidelines={elements.filter(e => !selected.includes(e.id) && !e.hidden).map(e => `[data-id="${e.id}"]`)}
            onDrag={e => { e.target.style.left = `${e.left}px`; e.target.style.top = `${e.top}px`; }}
            onDragEnd={e => { if (e.lastEvent) patch((e.target as HTMLElement).dataset.id!, { x: Math.round(e.lastEvent.left), y: Math.round(e.lastEvent.top) }); }}
            onDragGroup={e => e.events.forEach(ev => { ev.target.style.left = `${ev.left}px`; ev.target.style.top = `${ev.top}px`; })}
            onDragGroupEnd={e => { commit(d => { e.events.forEach(ev => { if (!ev.lastEvent) return; const el = d.elements.find(item => item.id === (ev.target as HTMLElement).dataset.id); if (el) { el.x = Math.round(ev.lastEvent.left); el.y = Math.round(ev.lastEvent.top); } }); }); }}
            onResize={e => { e.target.style.width = `${e.width}px`; e.target.style.height = `${e.height}px`; e.target.style.left = `${e.drag.left}px`; e.target.style.top = `${e.drag.top}px`; }}
            onResizeEnd={e => { if (e.lastEvent) { const ev = e.lastEvent; patch((e.target as HTMLElement).dataset.id!, { width: Math.max(8, Math.round(ev.width)), height: Math.max(8, Math.round(ev.height)), x: Math.round(ev.drag.left), y: Math.round(ev.drag.top) }); } }}
            onResizeGroup={e => e.events.forEach(ev => { Object.assign(ev.target.style, { width: `${ev.width}px`, height: `${ev.height}px`, left: `${ev.drag.left}px`, top: `${ev.drag.top}px` }); })}
            onResizeGroupEnd={e => commit(d => { e.events.forEach(ev => { if (!ev.lastEvent) return; const el = d.elements.find(item => item.id === (ev.target as HTMLElement).dataset.id); if (el) Object.assign(el, { width: Math.max(8, Math.round(ev.lastEvent.width)), height: Math.max(8, Math.round(ev.lastEvent.height)), x: Math.round(ev.lastEvent.drag.left), y: Math.round(ev.lastEvent.drag.top) }); }); })}
            onRotateStart={e => { e.set(elements.find(el => el.id === (e.target as HTMLElement).dataset.id)?.rotation || 0); }}
            onRotate={e => { e.target.style.transform = `rotate(${e.beforeRotate}deg)`; }} onRotateEnd={e => { if (e.lastEvent) patch((e.target as HTMLElement).dataset.id!, { rotation: Math.round(e.lastEvent.beforeRotate) }); }}
            onRotateGroupStart={e => e.events.forEach(ev => ev.set(elements.find(el => el.id === (ev.target as HTMLElement).dataset.id)?.rotation || 0))}
            onRotateGroup={e => e.events.forEach(ev => { ev.target.style.transform = ev.transform; })}
            onRotateGroupEnd={e => commit(d => { e.events.forEach(ev => { if (!ev.lastEvent) return; const el = d.elements.find(item => item.id === (ev.target as HTMLElement).dataset.id); if (el) Object.assign(el, { rotation: Math.round(ev.lastEvent.beforeRotate), x: Math.round(ev.lastEvent.drag.left), y: Math.round(ev.lastEvent.drag.top) }); }); })}
          />
        </div>);
  return <ProjectManagerProvider session={session} onBusyChange={setManaging}><div className="studio"><div className="editor-shell" inert={help} aria-hidden={help}>
    <header className="topbar"><div className="brand"><span className="brand-mark"><LayoutOutlined /></span><strong>forma</strong><span className="version">V 0.1</span></div><div className="header-right"><span className={`server-status ${server}`}><i />{server === 'ready' ? '本地服务已连接' : server === 'error' ? '服务连接失败' : '正在连接服务'}</span><Tooltip title={saveError || '自动保存到本机数据库 · Ctrl+S 立即保存'}><span className={`save-state ${saveStatus}`} data-save-status={saveStatus} role="status" aria-live="polite"><i/>{saveLabels[saveStatus]}</span></Tooltip>{saveStatus === 'error' ? <Button className="persistence-action" size="small" aria-label="重试保存" onClick={retry}>重试</Button> : saveStatus === 'conflict' ? <Button className="persistence-action" size="small" aria-label="读取服务器版本" onClick={() => modal.confirm({ title: '读取服务器版本？', content: '这会替换当前窗口尚未保存的修改。请先核对或复制需要保留的内容。', okText: '重新载入', cancelText: '取消', onOk: reload })}>重新载入</Button> : <Tooltip title="立即保存 Ctrl+S"><Button className="persistence-action" size="small" aria-label="立即保存" disabled={server !== 'ready' || saveStatus === 'saved' || saveStatus === 'saving'} onClick={() => { void flush(); }}>保存</Button></Tooltip>}<span className="header-divider"/><Button onClick={() => setHelp(true)} icon={<InfoCircleOutlined />}>使用指南</Button><Button loading={openingPreview} disabled={managing || server !== 'ready'} aria-label="预览原型" type="primary" onClick={startPreview} icon={<PlayCircleOutlined />}>预览原型</Button><span className="profile">ED</span></div></header>
    <div className="workspace-bar" inert={managing || openingPreview}><div className="workspace-title"><span className="page-indicator"/><span>页面</span><span className="subtle">/</span><strong>{editingDialog ? editingDialog.title : pageName}</strong>{editingDialog && <Button size="small" onClick={leaveDialog}>返回页面</Button>}</div><div className="canvas-tools"><Tool title="选择工具 (V)" active={!hand} onClick={() => setHand(false)}><AimOutlined /></Tool><Tool title="平移工具（按住空格）" active={hand} onClick={() => setHand(!hand)}><DragOutlined /></Tool><span className="tool-divider"/><Tool title="撤销 Ctrl+Z" disabled={!past.length} onClick={undo}><UndoOutlined /></Tool><Tool title="重做 Ctrl+Shift+Z" disabled={!future.length} onClick={redo}><RedoOutlined /></Tool><span className="tool-divider"/><Tool title="复制选中元素 Ctrl+D" disabled={!selected.length} onClick={duplicate}><CopyOutlined /></Tool><Tool title="删除 Delete" disabled={!editable.length} onClick={remove}><DeleteOutlined /></Tool></div><span className="workspace-note">自由画布 · Ant Design</span></div>
    <main className="editor-layout" inert={server !== 'ready' || managing || openingPreview} aria-busy={server === 'loading'}>
      <aside className="left-panel"><div className="panel-tabs"><button aria-label="页面" className={tab === 'pages' ? 'selected' : ''} onClick={() => setTab('pages')}>页面</button><button aria-label="元素" className={tab === 'elements' ? 'selected' : ''} onClick={() => setTab('elements')}><AppstoreOutlined /> 元素</button><button aria-label="图层" className={tab === 'layers' ? 'selected' : ''} onClick={() => setTab('layers')}><HolderOutlined /> 图层 <span>{elements.length}</span></button></div>
      {tab === 'pages' ? <PageTree/> : tab === 'elements' ? <><div className="library-search"><Input prefix={<SearchOutlined />} placeholder="搜索元素" value={search} onChange={e => setSearch(e.target.value)} allowClear /></div><div className="library-section"><div className="section-label">基础元素 <span>04</span></div><div className="element-grid">{kinds.slice(0, 4).filter(k => (kindNames[k] + ' ' + k + (k === 'select' ? ' 下拉框 下拉选择' : '')).toLowerCase().includes(search.toLowerCase())).map(kind => <button key={kind} aria-label={kindNames[kind]} className="element-card" draggable onDragStart={e => e.dataTransfer.setData('application/forma-element', kind)} onClick={() => add(kind)}><span className={`element-symbol ${kind}`}>{symbols[kind]}</span><span>{kindNames[kind]}</span></button>)}</div></div><div className="library-section"><div className="section-label">业务组件 <span className="antd-label">ANT DESIGN</span></div><div className="element-grid">{kinds.slice(4).filter(k => (kindNames[k] + ' ' + k + (k === 'select' ? ' 下拉框 下拉选择' : '')).toLowerCase().includes(search.toLowerCase())).map(kind => <button key={kind} aria-label={kindNames[kind]} className="element-card" draggable onDragStart={e => e.dataTransfer.setData('application/forma-element', kind)} onClick={() => add(kind)}><span className="element-symbol">{symbols[kind]}</span><span>{kindNames[kind]}</span></button>)}</div></div><div className="dialog-library"><div className="section-label">弹窗 <button aria-label="新建弹窗" onClick={createDialog}><PlusOutlined/> 新建</button></div>{doc.dialogs?.map(dialog => <button key={dialog.id} className={editingDialog?.id === dialog.id ? 'current' : ''} onClick={() => enterDialog(dialog.id)}><LayoutOutlined/><span>{dialog.title || '未命名弹窗'}</span><span>编辑</span></button>)}</div><div className="library-tip"><span className="tip-icon">✧</span><strong>从一个想法开始</strong><p>拖入元素，自由组合。<br/>让每个页面都可以被体验。</p><span>拖拽添加 · 点击快速插入</span></div></> : <div className="layer-list"><div className="section-label">{editingDialog ? '弹窗元素' : '页面元素'} <span>从上到下</span></div>{[...elements].reverse().map(e => <div key={e.id} className={`layer ${selected.includes(e.id) ? 'chosen' : ''}`}><button className="layer-name" onClick={event => select(event.shiftKey ? selected.includes(e.id) ? selected.filter(id => id !== e.id) : [...selected, e.id] : [e.id])}>{symbols[e.kind]}<span>{e.name}</span></button><button title={e.hidden ? '显示' : '隐藏'} aria-label={`${e.hidden ? '显示' : '隐藏'}${e.name}`} onClick={() => patch(e.id, { hidden: !e.hidden })}>{e.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}</button><button title={e.locked ? '解锁' : '锁定'} aria-label={`${e.locked ? '解锁' : '锁定'}${e.name}`} onClick={() => patch(e.id, { locked: !e.locked })}>{e.locked ? <LockOutlined /> : <UnlockOutlined />}</button></div>)}</div>}
      <div className="left-footer"><span className="green-dot"/> 本地工作空间 <span>原型工作台</span></div></aside>
      <section className="canvas-area"><div className="canvas-ruler"><span>{editingDialog ? `弹窗 · ${editingDialog.title}` : `${pageName} · ${doc.width} × ${doc.height}`}</span><span>{editingDialog ? '弹窗内容编辑' : '自由布局'}</span></div>{editingDialog && <div className="dialog-edit-banner"><span>正在编辑弹窗 · {editingDialog.title}</span><Button size="small" onClick={leaveDialog}>返回页面</Button></div>}<div className={`viewport ${hand || space || draggingView ? 'panning' : ''} ${draggingView ? 'dragging-view' : ''}`} style={{ backgroundPosition: `${viewOffset.x}px ${viewOffset.y}px` }} ref={viewport} onPointerDownCapture={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}>
        <div className="stage" style={{ minWidth: sceneWidth * zoom + 160, minHeight: sceneHeight * zoom + 170, transform: `translate(${viewOffset.x}px, ${viewOffset.y}px)` }}><div className="page-label" style={{ width: sceneWidth * zoom }}><span>{editingDialog ? `${pageName} / ${editingDialog.title}` : pageName}</span><span>{surface.width} × {surface.height}</span></div><div className="page-footprint" style={{ width: sceneWidth * zoom, height: sceneHeight * zoom }}>{editingDialog ? <div className="dialog-composition" style={{ width: sceneWidth, height: sceneHeight, transform: `scale(${zoom})` }}>
          <div className="dialog-page-backdrop" style={{ width: doc.width, height: doc.height, left: (sceneWidth - doc.width) / 2, top: (sceneHeight - doc.height) / 2 }} inert>{pageElements.filter(e => !e.hidden).map(e => <div key={e.id} style={elementStyle(e)}><ElementView element={e} values={initialValues(doc)}/></div>)}</div>
          <div className="dialog-edit-scrim"/>
          <div className="dialog-edit-window" style={{ width: editingDialog.width + 48, left: (sceneWidth - editingDialog.width - 48) / 2, top: Math.max(24, (sceneHeight - editingDialog.height - 104) / 2) }}>
            <div className="dialog-edit-header"><strong>{editingDialog.title || '未命名弹窗'}</strong><button aria-label="关闭弹窗编辑" onClick={leaveDialog}><CloseOutlined/></button></div>
            <div className="dialog-edit-body">{canvas}</div>
          </div></div> : canvas}</div><div className="artboard-caption"><span>✧</span> 一个画布，无限可能</div></div>
        <Selecto container={viewport.current} dragContainer={'.viewport'} selectableTargets={['.artboard .node:not([data-locked="true"])']} hitRate={0} selectByClick={false} selectFromInside={false} toggleContinueSelect={['shift']} dragCondition={e => !hand && !space && !pan.current && !editing && !(e.inputEvent.target as HTMLElement).closest('.node,.moveable-control,.moveable-line')} onSelectEnd={e => { select(e.selected.map(el => (el as HTMLElement).dataset.id!)); }} />
      </div><div className="canvas-bottom"><span><span className="shortcut-key">Space</span> 平移画布 <span className="shortcut-key">Shift</span> 多选</span><div className="zoom-controls"><Tool title="缩小" onClick={() => setZoom(z => Math.max(.1, +(z - .1).toFixed(2)))}><MinusOutlined /></Tool><Select aria-label="画布缩放" value={Math.round(zoom * 100)} onChange={v => setZoom(v / 100)} options={[...new Set([25, 50, 75, 80, 100, 125, 150, 200, Math.round(zoom * 100)])].sort((a, b) => a - b).map(v => ({ value: v, label: `${v}%` }))} variant="borderless" size="small"/><Tool title="放大" onClick={() => setZoom(z => Math.min(2, +(z + .1).toFixed(2)))}><PlusOutlined /></Tool><span className="tool-divider"/><Tool title="适应画布" onClick={fit}><AimOutlined /></Tool></div></div></section>
      <aside className="right-panel"><div className="panel-tabs"><button className={propTab === 'design' ? 'selected' : ''} onClick={() => setPropTab('design')}>设计</button><button className={propTab === 'interaction' ? 'selected' : ''} onClick={() => setPropTab('interaction')}>交互 {active && active.action !== 'none' && <i className="interaction-dot"/>}</button></div><div className="properties">
        {!active ? <><div className="property-heading"><span className="purple-icon"><LayoutOutlined /></span><div><strong>{editingDialog ? '弹窗设置' : '页面设置'}</strong><span>{editingDialog ? '自由布局容器' : '单页自由画布'}</span></div></div><div className="property-section"><h3>{editingDialog ? '弹窗内容尺寸' : '画布尺寸'}</h3>{editingDialog && <label className="stacked-label">弹窗标题<Input aria-label="弹窗标题" value={editingDialog.title} onChange={e => patchSurface({ title: e.target.value })}/></label>}<div className="field-grid"><label className="numeric"><span>W</span><InputNumber aria-label="画布宽度" min={320} max={4000} value={surface.width} controls={false} onChange={v => v && patchSurface({ width: v })}/></label><label className="numeric"><span>H</span><InputNumber aria-label="画布高度" min={200} max={4000} value={surface.height} controls={false} onChange={v => v && patchSurface({ height: v })}/></label></div><label className="color-field"><span>背景颜色</span><div><input type="color" aria-label="画布背景" value={surface.background} onChange={e => patchSurface({ background: e.target.value })}/><span>{surface.background.toUpperCase()}</span></div></label></div><div className="empty-inspector"><BorderOutlined /><strong>选中元素，开始创作</strong><p>在画布中点击元素，<br/>即可编辑外观与交互。</p></div></> : <>
        <div className="property-heading"><span className="purple-icon">{symbols[active.kind]}</span><div><strong>{selected.length > 1 ? `已选中 ${selected.length} 个元素` : kindNames[active.kind]}</strong><span>{active.locked ? '元素已锁定' : '自由布局元素'}</span></div><Tool title={active.locked ? '解锁元素' : '锁定元素'} onClick={() => patch(active.id, { locked: !active.locked })}>{active.locked ? <LockOutlined /> : <UnlockOutlined />}</Tool></div>
        {propTab === 'design' ? <><div className="property-section"><h3>排列与对齐</h3><div className="align-tools">{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((mode, i) => <Tool key={mode} title={['左对齐', '水平居中', '右对齐', '顶部对齐', '垂直居中', '底部对齐'][i]} disabled={!editable.length} onClick={() => align(mode)}><span className={`align-icon align-${mode}`}>Ⅲ</span></Tool>)}</div></div><fieldset disabled={disabled}><div className="property-section"><h3>位置与尺寸</h3><div className="field-grid">{numeric('X', 'x')}{numeric('Y', 'y')}{numeric('W', 'width', 8)}{numeric('H', 'height', 8)}{numeric('旋转', 'rotation')}{numeric('圆角', 'radius', 0)}</div></div><div className="property-section"><h3>内容 <span>{kindNames[active.kind]}</span></h3><label className="stacked-label">元素名称<Input aria-label="元素名称" value={active.name} onChange={e => patch(active.id, { name: e.target.value })}/></label>{!['rectangle', 'ellipse', 'line', 'switch', 'table'].includes(active.kind) && <label className="stacked-label">{active.kind === 'input' || active.kind === 'select' ? '占位文字' : '文字内容'}<Input.TextArea aria-label="文字内容" value={active.text} autoSize={{ minRows: 2, maxRows: 5 }} onChange={e => patch(active.id, { text: e.target.value })}/></label>}{active.kind === 'select' && <SelectProperties element={active} patch={patch}/ >}{active.kind === 'input' && editingDialog && <div className="input-validation-settings"><div className="visibility-row"><span>必填字段</span><Switch aria-label="必填字段" checked={!!active.required} size="small" onChange={required => patch(active.id, { required })}/></div><label className="stacked-label">校验类型<Select aria-label="校验类型" value={active.inputType || 'text'} onChange={inputType => patch(active.id, { inputType })} options={[{ value: 'text', label: '普通文本' }, { value: 'email', label: '邮箱' }]}/></label></div>}<ComponentProperties key={active.id} element={active} elements={doc.elements} patch={patch}/><label className="stacked-label">显示条件<ConditionProperties value={active.visibleWhen} elements={doc.elements.filter(e => e.id !== active.id)} onChange={visibleWhen => patch(active.id, { visibleWhen })}/></label></div><div className="property-section"><h3>外观</h3>{!['text', 'line', 'switch', 'select'].includes(active.kind) && color('填充', 'fill')}{!['rectangle', 'ellipse', 'line', 'switch', 'table'].includes(active.kind) && color('文字', 'color')}{!['text', 'switch', 'table', 'input', 'select'].includes(active.kind) && color('描边', 'stroke')}<div className="appearance-fields">{!['rectangle', 'ellipse', 'line', 'switch', 'table'].includes(active.kind) && numeric('字号', 'fontSize', 8)}{!['text', 'switch', 'table', 'input', 'select'].includes(active.kind) && numeric('线宽', 'strokeWidth', 0)}</div><div className="opacity-label"><span>不透明度</span><span>{Math.round(active.opacity * 100)}%</span></div><Slider aria-label="不透明度" min={0} max={100} value={Math.round(active.opacity * 100)} onChange={v => patch(active.id, { opacity: v / 100 })}/></div></fieldset><div className="property-section"><h3>图层顺序</h3><div className="layer-actions"><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'front')}>置顶</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'up')}>上移</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'down')}>下移</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'back')}>置底</Button></div><div className="visibility-row"><span>显示元素</span><Switch size="small" checked={!active.hidden} onChange={v => patch(active.id, { hidden: !v })}/></div></div></> : <div className="property-section"><h3>点击事件 <span>ON CLICK</span></h3><label className="stacked-label">执行动作<Select aria-label="点击执行动作" disabled={disabled} value={active.action} onChange={action => setAction(active, action)} options={[{ value: 'none', label: '无交互' }, { value: 'modal', label: '打开弹窗' }, { value: 'toast', label: '显示消息' }, { value: 'toggle', label: '切换元素显示 / 隐藏' }, { value: 'filter', label: '执行表格查询' }, { value: 'reset', label: '重置表格筛选' }, ...(editingDialog ? [{ value: 'apply', label: '应用弹窗选项并关闭' }, { value: 'closeModal', label: '关闭弹窗' }, { value: 'submit', label: '校验表单并关闭弹窗' }] : [])] }/></label>{['modal', 'toast', 'submit', 'apply'].includes(active.action) && <label className="stacked-label">{active.action === 'modal' ? '弹窗标题' : '消息内容'}<Input disabled={disabled} aria-label="交互内容" value={active.action === 'modal' ? doc.dialogs?.find(dialog => dialog.id === active.modalId)?.title || active.actionText : active.actionText} onChange={e => updateActionText(active, e.target.value)}/></label>}{active.action === 'modal' && <div className="modal-target-config"><label className="stacked-label">目标弹窗<Select aria-label="目标弹窗" disabled={disabled} value={active.modalId} options={doc.dialogs?.filter(dialog => dialog.id !== editingDialog?.id).map(dialog => ({ value: dialog.id, label: dialog.title }))} onChange={modalId => patch(active.id, { modalId })}/></label><Button block type="primary" disabled={disabled} onClick={() => enterDialog(ensureDialog(active))}>编辑目标弹窗</Button></div>}{['toggle', 'filter', 'reset'].includes(active.action) && <label className="stacked-label">目标元素<Select disabled={disabled} aria-label="交互目标元素" value={active.targetId} placeholder="选择一个元素" options={elements.filter(e => e.id !== active.id && (active.action === 'toggle' || e.kind === 'table')).map(e => ({ value: e.id, label: e.name }))} onChange={targetId => patch(active.id, { targetId })}/></label>}<div className="interaction-tip"><PlayCircleOutlined /><p>点击右上角「预览原型」<br/>体验配置好的交互。</p></div>{['input', 'select', 'switch', 'table'].includes(active.kind) && <p className="property-note">控件内部保留原生交互。点击事件当前适用于基础图形、文字和按钮。</p>}</div>}
        </>}
      </div><div className="inspector-footer"><span className="purple-dot"/> {saveLabels[saveStatus]}</div></aside>
    </main><footer className="statusbar"><span><span className="purple-dot"/> 编辑模式 <span className="status-divider">|</span> {selected.length ? `选中 ${selected.length} 个元素` : `${elements.length} 个元素`}</span><span>FORMA STUDIO <span className="status-divider">/</span> 让想法可以被体验</span></footer></div>
    <Modal open={help} title="开始你的第一个交互原型" onCancel={() => setHelp(false)} footer={<Button type="primary" onClick={() => setHelp(false)}>开始创作</Button>}><div className="help-content"><p>从左侧拖入基础图形或 Ant Design 组件，也可以点击快速添加。</p><p>选中元素后，在右侧修改位置、尺寸、颜色和内容。双击文本可以直接编辑。</p><p>按住 Shift 点击或拖动空白区域进行多选，通过工具栏对齐。按住空格拖动可平移画布。</p><p>在「图层」中调整隐藏和锁定，在右侧「交互」中配置点击动作。</p><p><b>Ctrl+C / V</b> 复制粘贴　<b>Ctrl+D</b> 创建副本<br/><b>Ctrl+Z</b> 撤销　<b>Ctrl+Shift+Z</b> 重做<br/><b>方向键</b> 移动 1px　<b>Shift+方向键</b> 移动 10px</p><p className="property-note">原型会自动保存到本机数据库，等待右上角显示「已保存」后再关闭。弹窗可从按钮交互或左侧弹窗列表进入编辑，表格使用固定示例数据。</p></div></Modal>
  </div></ProjectManagerProvider>;
}
