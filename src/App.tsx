import { CanvasFooter } from './CanvasFooter';
import { randomId } from '../shared/uuid';
import { BrandMark } from './BrandMark';
import { useEffect, useRef, useState, useLayoutEffect, type CSSProperties, type PointerEvent } from 'react';
import { App as AntApp, Button, Input, InputNumber, Select, Slider, Tooltip, Modal, Switch } from 'antd';
import { AppstoreOutlined, BorderOutlined, CopyOutlined, DeleteOutlined, DownOutlined, EyeInvisibleOutlined, EyeOutlined, FontSizeOutlined, HolderOutlined, LayoutOutlined, LockOutlined, MinusOutlined, PlusOutlined, RedoOutlined, SearchOutlined, TableOutlined, UndoOutlined, UnlockOutlined, PlayCircleOutlined, AimOutlined, DragOutlined, InfoCircleOutlined, CloseOutlined, FullscreenOutlined, FullscreenExitOutlined, SaveOutlined, CheckCircleOutlined, LoadingOutlined, WarningOutlined, ReloadOutlined, CommentOutlined } from '@ant-design/icons';
import Moveable from 'react-moveable';
import Selecto from 'react-selecto';
import { ElementView } from './ElementView';
import { clipboardImages, maxImageDocumentBytes } from './clipboard-images';
import { ComponentLibrary, elementSymbols as symbols } from './ComponentLibrary';
import { AntdProperties } from './AntdProperties';
import { AiPanel } from './AiPanel';
import { VersionManager } from './VersionManager';
import { AccountMenu, useAuth } from './AuthGate';
import { AnnotationLayer, AnnotationPanel } from './Annotations';
import { addAnnotation, surfaceAnnotations } from '../shared/annotations';
import type { PrototypeAnnotation } from '../shared/model';
import { SelectProperties } from './SelectProperties';
import { ComponentProperties, ConditionProperties, RowBindingProperties } from './ComponentProperties';
import { initialValues, rowActions, isFormControl } from '../shared/runtime';
import { PageDesignSurface } from './PageDesignSurface';
import { ProjectManagerProvider, PageTree } from './ProjectManager';
import { useDocumentSession, saveLabels } from './useDocumentSession';
import { useEditor } from './store';
import { elementKinds as kinds, kindNames, makeElement, makeDialog, type ElementKind, type PrototypeElement, type PrototypeDialog, type Action } from '../shared/model';

function elementStyle(e: PrototypeElement): CSSProperties { return { position: 'absolute', left: e.x, top: e.y, width: e.width, height: e.height, transform: `${e.importTransform ? `matrix(${e.importTransform.join(',')},0,0) ` : ''}rotate(${e.rotation}deg)`, opacity: e.opacity }; }
function Tool({ title, children, onClick, disabled = false, active = false }: { title: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean }) { return <Tooltip title={title}><button aria-label={title} className={`tool ${active ? 'active' : ''}`} disabled={disabled} onClick={onClick}>{children}</button></Tooltip>; }

export default function App() {
  const { message, modal } = AntApp.useApp(); const { user } = useAuth();
  const { doc, selected, past, future, select, commit, patch, undo, redo } = useEditor();
  const [tab, setTab] = useState<'pages' | 'elements' | 'layers'>('pages');
  const [propTab, setPropTab] = useState<'design' | 'interaction' | 'versions' | 'annotations'>('design');
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [placingAnnotation, setPlacingAnnotation] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(0.8);
  const [openingPreview, setOpeningPreview] = useState(false);
  const previewOpening = useRef(false);
  const [hand, setHand] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [aiVisible, setAiVisible] = useState(() => { try { return localStorage.getItem('forma:ai-visible') === 'true'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('forma:ai-visible', String(aiVisible)); } catch {} }, [aiVisible]);
  const [space, setSpace] = useState(false);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [draggingView, setDraggingView] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const session = useDocumentSession();
  useEffect(() => { if (!session.currentProjectId) return; document.title = `${session.projectName} · 原型设计`; try { localStorage.setItem(`forma:last-project:${user.id}`, session.currentProjectId); } catch {} }, [session.currentProjectId, session.projectName, user.id]);
  const { server, saveStatus, saveError, pageName, retry, flush, reload, currentPageId, currentProjectId } = session;
  const [help, setHelp] = useState(false);
  const [managing, setManaging] = useState(false);
  const [designView, setDesignView] = useState(false);
  useEffect(() => { if (designView) { setCanvasExpanded(false); setTab('pages'); select([]); setPlacingAnnotation(null); setEditing(null); } }, [designView]);
  const [editingDialogId, setEditingDialogId] = useState<string | null>(null);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const wheelZoom = useRef(zoom);
  wheelZoom.current = zoom;
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const moveable = useRef<Moveable>(null);
  const clipboard = useRef<PrototypeElement[]>([]);
  const imagePasteEpoch = useRef(0);
  const pan = useRef<{ x: number; y: number; offsetX: number; offsetY: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!aiVisible) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest('#ai-assistant-panel')) focused.blur();
      return;
    }
    const frame = requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('#ai-assistant-panel textarea')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [aiVisible, currentPageId]);

  useEffect(() => { setEditingDialogId(null); setEditing(null); setAnnotationId(null); setPlacingAnnotation(null); }, [currentPageId]);
  const editingDialog = doc.dialogs?.find(dialog => dialog.id === editingDialogId);
  const surface = editingDialog || doc;
  const pasteContext = useRef({ currentPageId, editingDialogId, canvasEpoch: session.canvasEpoch, canEdit: session.canEdit, blocked: false });
  pasteContext.current = { currentPageId, editingDialogId, canvasEpoch: session.canvasEpoch, canEdit: session.canEdit, blocked: server !== 'ready' || managing || openingPreview || help || designView };
  useEffect(() => { imagePasteEpoch.current++; return () => { imagePasteEpoch.current++; }; }, [currentPageId, editingDialogId, session.canvasEpoch]);
  const sceneWidth = Math.max(doc.width, editingDialog ? editingDialog.width + 128 : 0);
  const sceneHeight = Math.max(doc.height, editingDialog ? editingDialog.height + 200 : 0);
  const elements = doc.elements.filter(e => e.parentId === editingDialog?.id);
  const pageElements = doc.elements.filter(e => !e.parentId);
  const annotations = surfaceAnnotations(doc, editingDialog?.id);
  useEffect(() => { setAnnotationId(null); setPlacingAnnotation(null); }, [editingDialogId]);
  useEffect(() => { if (!session.canEdit) setPlacingAnnotation(null); }, [session.canEdit]);
  useEffect(() => { if (annotationId && !doc.annotations?.some(note => note.id === annotationId)) setAnnotationId(null); }, [doc.annotations, annotationId]);
  function selectAnnotation(id: string) { setAnnotationsVisible(true); setAnnotationId(id); setPlacingAnnotation(null); setPropTab('annotations'); setCanvasExpanded(false); select([]); }
  function beginAnnotation(id = 'new') { if (!session.canEdit) return; setPlacingAnnotation(id); setAnnotationsVisible(true); setPropTab('annotations'); setCanvasExpanded(false); select([]); setEditing(null); setHand(false); }
  function patchAnnotation(id: string, attributes: Partial<Pick<PrototypeAnnotation, 'title' | 'content'>>) { if (!session.canEdit) return; commit(d => { const note = d.annotations?.find(note => note.id === id); if (note) Object.assign(note, attributes); }); }
  function placeAnnotation(point: { x: number; y: number }) {
    if (!session.canEdit || !placingAnnotation) return;
    let id: string | undefined;
    commit(d => {
      if (placingAnnotation === 'new') id = addAnnotation(d, point, editingDialog?.id)?.id;
      else { const note = d.annotations?.find(note => note.id === placingAnnotation); if (note) { Object.assign(note, point); id = note.id; } }
    });
    if (id) selectAnnotation(id);
  }
  function showAnnotations(visible: boolean) { setAnnotationsVisible(visible); if (!visible) setPlacingAnnotation(null); }
  const annotationOverlay = <AnnotationLayer annotations={annotations} visible={annotationsVisible} selectedId={annotationId} placing={!!placingAnnotation} panning={hand || space || draggingView} pinScale={1 / zoom} style={{ width: surface.width, height: surface.height, transform: editingDialog ? undefined : `scale(${zoom})` }} onPlace={placeAnnotation} onSelect={selectAnnotation}/>;


  const active = elements.find(e => e.id === selected[0]);
  const editable = selected.map(id => elements.find(e => e.id === id)).filter((e): e is PrototypeElement => !!e && !e.locked);
  useLayoutEffect(() => { setTargets(selected.map(id => page.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)).filter((e): e is HTMLElement => !!e && e.dataset.locked !== 'true')); }, [selected, doc]);
  useEffect(() => { moveable.current?.updateRect(); }, [zoom, doc, viewOffset]);
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const footprint = viewport.current?.querySelector('.page-footprint')?.getBoundingClientRect();
    zoomAnchor.current = null;
    if (anchor && footprint) setViewOffset(old => ({ x: old.x + anchor.x - footprint.left, y: old.y + anchor.y - footprint.top }));
  }, [zoom]);
  useEffect(() => { if (server === 'ready') fit(); }, [server, currentPageId, editingDialogId]);
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? v.clientHeight : 1;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setViewOffset(old => ({ x: old.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit, y: old.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit }));
      } else {
        const oldZoom = wheelZoom.current;
        const step = Math.max(-100, Math.min(100, e.deltaY * unit));
        const nextZoom = Math.min(2, Math.max(.1, oldZoom * Math.exp(-step * Math.log(1.05) / 100)));
        if (nextZoom === oldZoom) return;
        const footprint = v.querySelector('.page-footprint')?.getBoundingClientRect();
        if (footprint) zoomAnchor.current = { x: e.clientX - (e.clientX - footprint.left) * nextZoom / oldZoom, y: e.clientY - (e.clientY - footprint.top) * nextZoom / oldZoom };
        wheelZoom.current = nextZoom;
        setZoom(nextZoom);
      }
    };
    v.addEventListener('wheel', wheel, { passive: false });
    return () => v.removeEventListener('wheel', wheel);
  }, []);
  function add(kind: ElementKind, x = 24, y = 24) { const e = { ...makeElement(kind, Math.round(x), Math.round(y)), parentId: editingDialog?.id }; commit(d => { d.elements.push(e); }); select([e.id]); }
  function remove() { commit(d => { d.elements = d.elements.filter(e => !selected.includes(e.id) || e.locked); }); select([]); }
  function copy() { clipboard.current = structuredClone(elements.filter(e => selected.includes(e.id))); }
  function paste() { const copies = clipboard.current.map(e => ({ ...structuredClone(e), id: randomId(), x: e.x + 24, y: e.y + 24, locked: false, parentId: editingDialog?.id, source: undefined, name: `${e.name} 副本` })); if (!copies.length) return; commit(d => { d.elements.push(...copies); }); select(copies.map(e => e.id)); clipboard.current = copies; }
  function duplicate() { copy(); paste(); }
  useEffect(() => {
    const ignoreClipboard = (target: EventTarget | null) => pasteContext.current.blocked || !pasteContext.current.canEdit ||
      (target instanceof Element && !!target.closest('input,textarea,[contenteditable]:not([contenteditable="false"]),.ant-select,.ai-panel')) ||
      [...document.querySelectorAll('[role="dialog"]')].some(el => el.getClientRects().length);
    const onCopy = (event: ClipboardEvent) => {
      if (ignoreClipboard(event.target) || !event.clipboardData || !selected.length) return;
      copy();
      event.preventDefault();
      event.clipboardData.setData('application/x-forma-selection', 'local');
      event.clipboardData.setData('text/plain', 'Forma 原型元素');
    };
    const onPaste = (event: ClipboardEvent) => {
      if (ignoreClipboard(event.target) || !event.clipboardData) return;
      const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
      if (!files.length) {
        if (event.clipboardData.getData('application/x-forma-selection') === 'local') { event.preventDefault(); paste(); }
        return;
      }
      event.preventDefault();
      const stamp = imagePasteEpoch.current;
      const context = { ...pasteContext.current };
      const canvasRect = page.current?.getBoundingClientRect(), viewRect = viewport.current?.getBoundingClientRect();
      let center = { x: surface.width / 2, y: surface.height / 2 };
      if (canvasRect && viewRect && canvasRect.width && canvasRect.height) {
        const left = Math.max(canvasRect.left, viewRect.left), right = Math.min(canvasRect.right, viewRect.right);
        const top = Math.max(canvasRect.top, viewRect.top), bottom = Math.min(canvasRect.bottom, viewRect.bottom);
        if (right > left && bottom > top) center = { x: ((left + right) / 2 - canvasRect.left) * surface.width / canvasRect.width, y: ((top + bottom) / 2 - canvasRect.top) * surface.height / canvasRect.height };
      }
      void clipboardImages(files, surface, center, editingDialog?.id).then(images => {
        const latest = pasteContext.current;
        if (stamp !== imagePasteEpoch.current || latest.currentPageId !== context.currentPageId || latest.editingDialogId !== context.editingDialogId || latest.canvasEpoch !== context.canvasEpoch || !latest.canEdit || latest.blocked || useEditor.getState().readOnly) return;
        const document = useEditor.getState().doc;
        if (new TextEncoder().encode(JSON.stringify({ ...document, elements: [...document.elements, ...images] })).length > maxImageDocumentBytes) throw Error('粘贴后页面内容超过 8MB，请压缩图片或减少页面内容');
        commit(d => { d.elements.push(...images); }); select(images.map(image => image.id));
      }).catch(error => { if (stamp === imagePasteEpoch.current) void message.error(error instanceof Error ? error.message : '图片粘贴失败'); });
    };
    window.addEventListener('copy', onCopy); window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('copy', onCopy); window.removeEventListener('paste', onPaste); };
  });
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
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
      const target = e.target instanceof Element ? e.target : null;
      const overlayOpen = [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],.ant-image-preview-wrap')].some(element => element.getClientRects().length);
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'Enter' && !e.isComposing && !overlayOpen) {
        e.preventDefault();
        if (!e.repeat) void startPreview();
        return;
      }
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing && !overlayOpen && !target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],.ant-select,.ai-panel')) {
        e.preventDefault();
        if (!e.repeat) setCanvasExpanded(value => !value);
        return;
      }
      if (!designView && e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'Backquote' || e.key === '`' || e.key === '~')) {
        e.preventDefault();
        if (!e.repeat && !e.isComposing) setAiVisible(value => !value);
        return;
      }
      if (e.key === 'Escape' && placingAnnotation && !e.isComposing) { e.preventDefault(); setPlacingAnnotation(null); return; }
      if (e.key === 'Escape' && canvasExpanded && !e.isComposing && !overlayOpen) { e.preventDefault(); setCanvasExpanded(false); return; }
      if (designView) return;
      if ((e.target as HTMLElement).closest('.ai-panel')) return;
      if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"],.ant-select')) return;
      if (!session.canEdit) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl && e.key.toLowerCase() === 'v') setHand(false);
      if (e.code === 'Space') { e.preventDefault(); setSpace(true); }
      if (e.key === 'Escape') { select([]); setEditing(null); }
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); select(elements.filter(e => !e.locked && !e.hidden).map(e => e.id)); }
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
  const disabled = active?.locked || !session.canEdit;
  const canvas = (<div ref={page} key={session.canvasEpoch} className="artboard" inert={!session.canEdit} style={{ width: surface.width, height: surface.height, background: surface.background, transform: editingDialog ? undefined : `scale(${zoom})`, position: editingDialog ? 'relative' : 'absolute' }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const kind = e.dataTransfer.getData('application/forma-element') as ElementKind; if (!kinds.includes(kind)) return; const rect = e.currentTarget.getBoundingClientRect(); add(kind, Math.max(0, (e.clientX - rect.left) / zoom), Math.max(0, (e.clientY - rect.top) / zoom)); }}>
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
  return <ProjectManagerProvider session={session} onBusyChange={setManaging} onDesignViewChange={setDesignView}><div className={`studio ${canvasExpanded ? 'canvas-expanded' : ''}`} data-server-state={server}><div className="editor-shell" inert={help} aria-hidden={help}>
    <header className="topbar"><div className="brand"><a className="brand-home" aria-label="返回首页" title="返回首页" href={`/?${new URLSearchParams({ projectId: currentProjectId })}`} aria-disabled={server !== 'ready' || managing || openingPreview} onClick={event => { event.preventDefault(); if (server !== 'ready' || managing || openingPreview) return; void flush().then(saved => { if (saved) window.location.assign(`/?${new URLSearchParams({ projectId: currentProjectId })}`); else void message.warning('请先保存或处理当前页面的修改'); }); }}><BrandMark/><strong>forma</strong></a><span className="version">V 0.1</span></div><div className="canvas-tools" inert={designView || server !== 'ready' || managing || openingPreview}><Tool title="选择工具 (V)" active={!hand} onClick={() => setHand(false)}><AimOutlined /></Tool><Tool title="平移工具（按住空格）" active={hand} onClick={() => setHand(!hand)}><DragOutlined /></Tool><span className="tool-divider"/><Tool title="撤销 Ctrl+Z" disabled={!session.canEdit || !past.length} onClick={undo}><UndoOutlined /></Tool><Tool title="重做 Ctrl+Shift+Z" disabled={!session.canEdit || !future.length} onClick={redo}><RedoOutlined /></Tool><span className="tool-divider"/><Tool title="复制选中元素 Ctrl+D" disabled={!selected.length} onClick={duplicate}><CopyOutlined /></Tool><Tool title="删除 Delete" disabled={!editable.length} onClick={remove}><DeleteOutlined /></Tool></div><div className="header-right"><Tooltip title={saveError || saveLabels[saveStatus]} trigger={['hover', 'focus']}><span tabIndex={0} className={`save-state ${saveStatus}`} data-save-status={saveStatus} role="status" aria-label={saveError || saveLabels[saveStatus]} aria-live="polite">{saveStatus === 'saving' || saveStatus === 'loading' ? <LoadingOutlined/> : saveStatus === 'error' || saveStatus === 'conflict' ? <WarningOutlined/> : saveStatus === 'unsaved' ? <SaveOutlined/> : <CheckCircleOutlined/>}</span></Tooltip>{saveStatus === 'error' ? <Tooltip title="重试保存"><Button className="persistence-action" size="small" aria-label="重试保存" icon={<ReloadOutlined/>} onClick={retry}/></Tooltip> : saveStatus === 'conflict' ? <Tooltip title="读取服务器版本"><Button className="persistence-action" size="small" aria-label="读取服务器版本" icon={<ReloadOutlined/>} onClick={() => modal.confirm({ title: '读取服务器版本？', content: '这会替换当前窗口尚未保存的修改。请先核对或复制需要保留的内容。', okText: '重新载入', cancelText: '取消', onOk: reload })}/></Tooltip> : null}<Tooltip title="使用指南"><Button aria-label="使用指南" onClick={() => setHelp(true)} icon={<InfoCircleOutlined />}/></Tooltip><Tooltip title="预览原型"><Button loading={openingPreview} disabled={managing || server !== 'ready'} aria-label="预览原型" type="primary" onClick={startPreview} icon={<PlayCircleOutlined />}/></Tooltip><AccountMenu projectId={currentProjectId} projectRole={session.projectRole} flush={flush}/></div></header>
    <main className={`editor-layout ${canvasExpanded ? 'canvas-expanded' : ''} ${designView ? 'viewing-ui-design' : ''}`} inert={server !== 'ready' || managing || openingPreview} aria-busy={server === 'loading'}>
      <aside className="left-panel"><div className="panel-tabs"><button aria-label="页面" className={tab === 'pages' ? 'selected' : ''} onClick={() => setTab('pages')}>页面</button><button aria-label="元素" disabled={designView} className={tab === 'elements' ? 'selected' : ''} onClick={() => setTab('elements')}><AppstoreOutlined /> 元素</button><button aria-label="图层" disabled={designView} className={tab === 'layers' ? 'selected' : ''} onClick={() => setTab('layers')}><HolderOutlined /> 图层 <span>{elements.length}</span></button></div>
      {tab === 'pages' ? <PageTree/> : tab === 'elements' ? <><div className="library-search"><Input prefix={<SearchOutlined />} placeholder="搜索元素" value={search} onChange={e => setSearch(e.target.value)} allowClear /></div><ComponentLibrary search={search} disabled={!session.canEdit} add={add}/><div className="dialog-library"><div className="section-label">弹窗 <button aria-label="新建弹窗" disabled={!session.canEdit} onClick={createDialog}><PlusOutlined/> 新建</button></div>{doc.dialogs?.map(dialog => <button key={dialog.id} className={editingDialog?.id === dialog.id ? 'current' : ''} onClick={() => enterDialog(dialog.id)}><LayoutOutlined/><span>{dialog.title || '未命名弹窗'}</span><span>编辑</span></button>)}</div><div className="library-tip"><span className="tip-icon">✧</span><strong>从一个想法开始</strong><p>拖入元素，自由组合。<br/>让每个页面都可以被体验。</p><span>拖拽添加 · 点击快速插入</span></div></> : <div className="layer-list"><div className="section-label">{editingDialog ? '弹窗元素' : '页面元素'} <span>从上到下</span></div>{[...elements].reverse().map(e => <div key={e.id} className={`layer ${selected.includes(e.id) ? 'chosen' : ''}`}><button className="layer-name" onClick={event => select(event.shiftKey ? selected.includes(e.id) ? selected.filter(id => id !== e.id) : [...selected, e.id] : [e.id])}>{symbols[e.kind]}<span>{e.name}</span></button><button title={e.hidden ? '显示' : '隐藏'} aria-label={`${e.hidden ? '显示' : '隐藏'}${e.name}`} onClick={() => patch(e.id, { hidden: !e.hidden })}>{e.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}</button><button title={e.locked ? '解锁' : '锁定'} aria-label={`${e.locked ? '解锁' : '锁定'}${e.name}`} onClick={() => patch(e.id, { locked: !e.locked })}>{e.locked ? <LockOutlined /> : <UnlockOutlined />}</button></div>)}</div>}
      <div className="left-footer"><span className="green-dot"/> 本地工作空间 <span>原型工作台</span></div></aside>
      <section className="canvas-area"><PageDesignSurface><div className="canvas-ruler"><span>{editingDialog && '弹窗 · '}<strong className="current-page-name">{editingDialog ? editingDialog.title : pageName}</strong>{!editingDialog && ` · ${doc.width} × ${doc.height}`}</span><span className="canvas-ruler-actions"><Button className="annotation-toolbar-button" type="text" size="small" aria-label="打开标注面板" aria-pressed={propTab === 'annotations'} icon={<CommentOutlined/>} onClick={() => { setPropTab('annotations'); setCanvasExpanded(false); setAnnotationsVisible(true); }}>标注{annotations.length ? ` · ${annotations.length}` : ''}</Button><Tooltip title={annotationsVisible ? '隐藏标注层' : '显示标注层'}><Button type="text" size="small" aria-label={annotationsVisible ? '隐藏标注层' : '显示标注层'} aria-pressed={annotationsVisible} icon={annotationsVisible ? <EyeOutlined/> : <EyeInvisibleOutlined/>} onClick={() => showAnnotations(!annotationsVisible)}/></Tooltip>{editingDialog && <span>弹窗内容编辑</span>}{(session.leaseError || session.lease.username && !session.lease.owned) && <span className="editing-hint" role="status" title={session.leaseError || `${session.lease.username} 正在编辑，当前仅可查看`}>{session.leaseError || `${session.lease.username} 正在编辑`}</span>}<Tooltip title={canvasExpanded ? '退出画布全屏（Esc）' : '画布全屏 · 隐藏两侧面板'}><Button type="text" size="small" aria-label={canvasExpanded ? '退出画布全屏' : '画布全屏'} aria-pressed={canvasExpanded} icon={canvasExpanded ? <FullscreenExitOutlined/> : <FullscreenOutlined/>} onClick={() => setCanvasExpanded(value => !value)}/></Tooltip></span></div>{editingDialog && <div className="dialog-edit-banner"><span>正在编辑弹窗 · {editingDialog.title}</span><Button size="small" onClick={leaveDialog}>返回页面</Button></div>}<div className={`viewport ${hand || space || draggingView ? 'panning' : ''} ${draggingView ? 'dragging-view' : ''}`} style={{ backgroundPosition: `${viewOffset.x}px ${viewOffset.y}px` }} ref={viewport} onPointerDownCapture={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan}>
        <div className="stage" style={{ minWidth: sceneWidth * zoom + 160, minHeight: sceneHeight * zoom + 170, transform: `translate(${viewOffset.x}px, ${viewOffset.y}px)` }}><div className="page-label" style={{ width: sceneWidth * zoom }}><span>{editingDialog ? `${pageName} / ${editingDialog.title}` : pageName}</span><span>{surface.width} × {surface.height}</span></div><div className="page-footprint" style={{ width: sceneWidth * zoom, height: sceneHeight * zoom }}>{editingDialog ? <div className="dialog-composition" style={{ width: sceneWidth, height: sceneHeight, transform: `scale(${zoom})` }}>
          <div className="dialog-page-backdrop" style={{ width: doc.width, height: doc.height, left: (sceneWidth - doc.width) / 2, top: (sceneHeight - doc.height) / 2 }} inert>{pageElements.filter(e => !e.hidden).map(e => <div key={e.id} style={elementStyle(e)}><ElementView element={e} values={initialValues(doc)}/></div>)}</div>
          <div className="dialog-edit-scrim"/>
          <div className="dialog-edit-window" style={{ width: editingDialog.width + 48, left: (sceneWidth - editingDialog.width - 48) / 2, top: Math.max(24, (sceneHeight - editingDialog.height - 104) / 2) }}>
            <div className="dialog-edit-header"><strong>{editingDialog.title || '未命名弹窗'}</strong><button aria-label="关闭弹窗编辑" onClick={leaveDialog}><CloseOutlined/></button></div>
            <div className="dialog-edit-body"><div className="annotation-editor-surface">{canvas}{annotationOverlay}</div></div>
          </div></div> : <>{canvas}{annotationOverlay}</>}</div></div>
        <Selecto container={viewport.current} dragContainer={'.viewport'} selectableTargets={['.artboard .node:not([data-locked="true"])']} hitRate={0} selectByClick={false} selectFromInside={false} toggleContinueSelect={['shift']} dragCondition={e => !hand && !space && !pan.current && !editing && !(e.inputEvent.target as HTMLElement).closest('.node,.moveable-control,.moveable-line,.annotation-layer')} onSelectEnd={e => { select(e.selected.map(el => (el as HTMLElement).dataset.id!)); }} />
      </div><CanvasFooter zoom={zoom} onZoomChange={setZoom} onZoomOut={() => setZoom(z => Math.max(.1, +(z - .1).toFixed(2)))} onZoomIn={() => setZoom(z => Math.min(2, +(z + .1).toFixed(2)))} onFit={fit}/>{currentPageId && <AiPanel key={currentPageId} visible={aiVisible} session={session} dialogId={editingDialogId || undefined}/>}</PageDesignSurface></section>
      <aside className="right-panel" inert={designView}><div className="panel-tabs"><button className={propTab === 'design' ? 'selected' : ''} onClick={() => setPropTab('design')}>设计</button><button className={propTab === 'interaction' ? 'selected' : ''} onClick={() => setPropTab('interaction')}>交互 {active && active.action !== 'none' && <i className="interaction-dot"/>}</button><button aria-label="标注管理" className={propTab === 'annotations' ? 'selected' : ''} onClick={() => { setPropTab('annotations'); setAnnotationsVisible(true); }}>标注</button><button aria-label="项目版本管理" className={propTab === 'versions' ? 'selected' : ''} onClick={() => setPropTab('versions')}>版本管理</button></div><div className="properties">
        {propTab === 'annotations' ? <AnnotationPanel annotations={annotations} selectedId={annotationId} canEdit={session.canEdit} visible={annotationsVisible} placing={!!placingAnnotation} total={doc.annotations?.length || 0} dialog={!!editingDialog} onVisible={showAnnotations} onAdd={() => beginAnnotation()} onSelect={selectAnnotation} onChange={patchAnnotation} onDelete={id => { if (session.canEdit) commit(d => { d.annotations = d.annotations?.filter(note => note.id !== id); }); }} onReposition={beginAnnotation} onCancel={() => setPlacingAnnotation(null)}/> : propTab === 'versions' ? <VersionManager key={currentProjectId} session={session}/> : !active ? <><div className="property-heading"><span className="purple-icon"><LayoutOutlined /></span><div><strong>{editingDialog ? '弹窗设置' : '页面设置'}</strong><span>{editingDialog ? '自由布局容器' : '单页自由画布'}</span></div></div><div className="property-section"><h3>{editingDialog ? '弹窗内容尺寸' : '画布尺寸'}</h3>{editingDialog && <label className="stacked-label">弹窗标题<Input aria-label="弹窗标题" value={editingDialog.title} onChange={e => patchSurface({ title: e.target.value })}/></label>}<div className="field-grid"><label className="numeric"><span>W</span><InputNumber aria-label="画布宽度" min={320} max={4000} value={surface.width} controls={false} onChange={v => v && patchSurface({ width: v })}/></label><label className="numeric"><span>H</span><InputNumber aria-label="画布高度" min={200} max={4000} value={surface.height} controls={false} onChange={v => v && patchSurface({ height: v })}/></label></div><label className="color-field"><span>背景颜色</span><div><input type="color" aria-label="画布背景" value={surface.background} onChange={e => patchSurface({ background: e.target.value })}/><span>{surface.background.toUpperCase()}</span></div></label></div><div className="empty-inspector"><BorderOutlined /><strong>选中元素，开始创作</strong><p>在画布中点击元素，<br/>即可编辑外观与交互。</p></div></> : <>
        <div className="property-heading"><span className="purple-icon">{symbols[active.kind]}</span><div><strong>{selected.length > 1 ? `已选中 ${selected.length} 个元素` : kindNames[active.kind]}</strong><span>{active.locked ? '元素已锁定' : '自由布局元素'}</span></div><Tool title={active.locked ? '解锁元素' : '锁定元素'} onClick={() => patch(active.id, { locked: !active.locked })}>{active.locked ? <LockOutlined /> : <UnlockOutlined />}</Tool></div>
        {propTab === 'design' ? <><div className="property-section"><h3>排列与对齐</h3><div className="align-tools">{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((mode, i) => <Tool key={mode} title={['左对齐', '水平居中', '右对齐', '顶部对齐', '垂直居中', '底部对齐'][i]} disabled={!editable.length} onClick={() => align(mode)}><span className={`align-icon align-${mode}`}>Ⅲ</span></Tool>)}</div></div><fieldset disabled={disabled}><div className="property-section"><h3>位置与尺寸</h3><div className="field-grid">{numeric('X', 'x')}{numeric('Y', 'y')}{numeric('W', 'width', 8)}{numeric('H', 'height', 8)}{numeric('旋转', 'rotation')}{numeric('圆角', 'radius', 0)}</div></div><div className="property-section"><h3>内容 <span>{kindNames[active.kind]}</span></h3><label className="stacked-label">元素名称<Input aria-label="元素名称" value={active.name} onChange={e => patch(active.id, { name: e.target.value })}/></label>{!['rectangle', 'ellipse', 'line', 'vector', 'switch', 'table'].includes(active.kind) && <label className="stacked-label">{active.kind === 'input' || active.kind === 'select' ? '占位文字' : '文字内容'}<Input.TextArea aria-label="文字内容" value={active.text} autoSize={{ minRows: 2, maxRows: 5 }} onChange={e => patch(active.id, { text: e.target.value })}/></label>}{active.kind === 'select' && <SelectProperties element={active} patch={patch}/ >}{isFormControl(active) && editingDialog && <div className="input-validation-settings"><div className="visibility-row"><span>必填字段</span><Switch aria-label="必填字段" checked={!!active.required} size="small" onChange={required => patch(active.id, { required })}/></div><label className="stacked-label">校验类型<Select aria-label="校验类型" value={active.inputType || 'text'} onChange={inputType => patch(active.id, { inputType })} options={[{ value: 'text', label: '普通文本' }, { value: 'email', label: '邮箱' }]}/></label></div>}{active.source?.groups.length ? <div className="import-groups"><p className="property-note">原设计分组（选择后可整体移动、缩放）</p>{active.source.groups.slice(-4).map(group => <Button key={group.id} size="small" style={{ maxWidth: '100%', marginBottom: 6, overflow: 'hidden' }} onClick={() => select(elements.filter(e => !e.locked && !e.hidden && e.source?.groups.some(g => g.id === group.id)).map(e => e.id))}>选择分组：{group.name}</Button>)}</div> : null}{!!active.typography?.runs?.length && <p className="property-note">原稿包含多段文字样式。当前按整段编辑，改写内容后将使用统一基础样式。</p>}<AntdProperties element={active} patch={patch}/><RowBindingProperties element={active} elements={doc.elements} patch={patch}/><ComponentProperties key={active.id} element={active} elements={doc.elements} patch={patch} dialogs={doc.dialogs} editDialog={enterDialog} createRowDialog={actionId => { const created = makeDialog('新建行操作弹窗'); commit(d => { (d.dialogs ||= []).push(created.dialog); d.elements.push(...created.elements); const table = d.elements.find(e => e.id === active.id)?.table; if (table) table.rowActions = rowActions(table).map(a => a.id === actionId ? { ...a, action: 'modal', modalId: created.dialog.id } : a); }); enterDialog(created.dialog.id); }}/><label className="stacked-label">显示条件<ConditionProperties value={active.visibleWhen} elements={doc.elements.filter(e => e.id !== active.id)} onChange={visibleWhen => patch(active.id, { visibleWhen })}/></label></div><div className="property-section"><h3>外观</h3>{!['text', 'line', 'switch', 'select'].includes(active.kind) && color('填充', 'fill')}{!['rectangle', 'ellipse', 'line', 'switch', 'table'].includes(active.kind) && color('文字', 'color')}{!['text', 'switch', 'table', 'input', 'select'].includes(active.kind) && color('描边', 'stroke')}<div className="appearance-fields">{!['rectangle', 'ellipse', 'line', 'switch', 'table'].includes(active.kind) && numeric('字号', 'fontSize', 12)}{!['text', 'switch', 'table', 'input', 'select'].includes(active.kind) && numeric('线宽', 'strokeWidth', 0)}</div><div className="opacity-label"><span>不透明度</span><span>{Math.round(active.opacity * 100)}%</span></div><Slider aria-label="不透明度" min={0} max={100} value={Math.round(active.opacity * 100)} onChange={v => patch(active.id, { opacity: v / 100 })}/></div></fieldset><div className="property-section"><h3>图层顺序</h3><div className="layer-actions"><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'front')}>置顶</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'up')}>上移</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'down')}>下移</Button><Button size="small" disabled={disabled} onClick={() => reorder(active.id, 'back')}>置底</Button></div><div className="visibility-row"><span>显示元素</span><Switch size="small" checked={!active.hidden} onChange={v => patch(active.id, { hidden: !v })}/></div></div></> : <div className="property-section"><h3>点击事件 <span>ON CLICK</span></h3><label className="stacked-label">执行动作<Select aria-label="点击执行动作" disabled={disabled} value={active.action} onChange={action => setAction(active, action)} options={[{ value: 'none', label: '无交互' }, { value: 'modal', label: '打开弹窗' }, { value: 'toast', label: '显示消息' }, { value: 'toggle', label: '切换元素显示 / 隐藏' }, { value: 'filter', label: '执行表格查询' }, { value: 'reset', label: '重置表格筛选' }, ...(editingDialog ? [{ value: 'apply', label: '应用弹窗选项并关闭' }, { value: 'closeModal', label: '关闭弹窗' }, { value: 'submit', label: '校验表单并关闭弹窗' }, { value: 'updateRow', label: '更新当前模拟行并关闭' }, { value: 'deleteRow', label: '删除当前模拟行并关闭' }] : [])] }/></label>{['modal', 'toast', 'submit', 'apply', 'updateRow', 'deleteRow'].includes(active.action) && <label className="stacked-label">{active.action === 'modal' ? '弹窗标题' : '消息内容'}<Input disabled={disabled} aria-label="交互内容" value={active.action === 'modal' ? doc.dialogs?.find(dialog => dialog.id === active.modalId)?.title || active.actionText : active.actionText} onChange={e => updateActionText(active, e.target.value)}/></label>}{active.action === 'modal' && <div className="modal-target-config"><label className="stacked-label">目标弹窗<Select aria-label="目标弹窗" disabled={disabled} value={active.modalId} options={doc.dialogs?.filter(dialog => dialog.id !== editingDialog?.id).map(dialog => ({ value: dialog.id, label: dialog.title }))} onChange={modalId => patch(active.id, { modalId })}/></label><Button block type="primary" disabled={disabled} onClick={() => enterDialog(ensureDialog(active))}>编辑目标弹窗</Button></div>}{['toggle', 'filter', 'reset'].includes(active.action) && <label className="stacked-label">目标元素<Select disabled={disabled} aria-label="交互目标元素" value={active.targetId} placeholder="选择一个元素" options={elements.filter(e => e.id !== active.id && (active.action === 'toggle' || e.kind === 'table')).map(e => ({ value: e.id, label: e.name }))} onChange={targetId => patch(active.id, { targetId })}/></label>}<div className="interaction-tip"><PlayCircleOutlined /><p>点击右上角「预览原型」<br/>体验配置好的交互。</p></div>{['input', 'select', 'switch', 'table'].includes(active.kind) && <p className="property-note">控件内部保留原生交互。点击事件当前适用于基础图形、文字和按钮。</p>}</div>}
        </>}
      </div><div className="inspector-footer"><span className="purple-dot"/> {saveLabels[saveStatus]}</div></aside>
    </main><footer className="statusbar"><span><span className="purple-dot"/> 编辑模式 <span className="status-divider">|</span> {selected.length ? `选中 ${selected.length} 个元素` : `${elements.length} 个元素`}</span><span>FORMA STUDIO <span className="status-divider">/</span> 让想法可以被体验</span></footer></div>
    <Modal open={help} title="开始你的第一个交互原型" onCancel={() => setHelp(false)} footer={<Button type="primary" onClick={() => setHelp(false)}>开始创作</Button>}><div className="help-content"><p>从左侧拖入基础图形或 Ant Design 组件，也可以点击快速添加。</p><p>选中元素后，在右侧修改位置、尺寸、颜色和内容。双击文本可以直接编辑。</p><p>按住 Shift 点击或拖动空白区域进行多选，通过工具栏对齐。按住空格拖动可平移画布。</p><p>在「图层」中调整隐藏和锁定，在右侧「交互」中配置点击动作。</p><p><b>Ctrl+C / V</b> 复制粘贴　<b>Ctrl+D</b> 创建副本<br/><b>Ctrl+Z</b> 撤销　<b>Ctrl+Shift+Z</b> 重做<br/><b>Ctrl+~</b> 显示 / 隐藏 AI 聊天框<br/><b>方向键</b> 移动 1px　<b>Shift+方向键</b> 移动 10px</p><p className="property-note">原型会自动保存到本机数据库，等待右上角显示「已保存」后再关闭。弹窗可从按钮交互或左侧弹窗列表进入编辑，表格使用固定示例数据。</p></div></Modal>
  </div></ProjectManagerProvider>;
}
