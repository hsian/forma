import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { Button, Select, Tooltip } from 'antd';
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import type { PrototypeDocument } from '../shared/model';
import { initialValues } from '../shared/runtime';
import { ElementView } from './ElementView';
import { hitDesignElement } from '../shared/design-inspection';

type View = { zoom: number; x: number; y: number };
const clampZoom = (zoom: number) => Math.min(8, Math.max(.01, zoom));

const DesignBoard = memo(function DesignBoard({ doc }: { doc: PrototypeDocument }) {
  const values = initialValues(doc);
  return <div className="ui-design-board" aria-label="UI 设计稿预览" style={{ width: doc.width, height: doc.height, background: doc.background }}>
    <div inert style={{width:'100%',height:'100%'}}>{doc.elements.filter(element => !element.hidden && !element.parentId).map(element => <div key={element.id} style={{position:'absolute',left:element.x,top:element.y,width:element.width,height:element.height,opacity:element.opacity,transform:`${element.importTransform ? `matrix(${element.importTransform.join(',')},0,0) ` : ''}rotate(${element.rotation}deg)`}}><ElementView element={element} values={values}/></div>)}</div>
  </div>;
});

export function DesignCanvas({ doc, name, selectedIds = [], onSelect }: { doc: PrototypeDocument; name?: string; selectedIds?: string[]; onSelect?: (ids: string[]) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 32, y: 48 });
  const currentView = useRef(view);
  const fitting = useRef(true);
  const drag = useRef<{ pointerId: number; x: number; y: number; view: View } | null>(null);
  const [dragging, setDragging] = useState(false);
  function update(next: View) { currentView.current = next; setView(next); }
  function fit() {
    const element = viewport.current;
    if (!element || !element.clientWidth || !element.clientHeight) return;
    fitting.current = true;
    const zoom = clampZoom(Math.min(1, (element.clientWidth - 64) / doc.width, (element.clientHeight - 96) / doc.height));
    update({ zoom, x: (element.clientWidth - doc.width * zoom) / 2, y: (element.clientHeight - doc.height * zoom) / 2 + 12 });
  }
  function zoomTo(zoom: number, anchor?: { x: number; y: number }) {
    const element = viewport.current;
    if (!element) return;
    const old = currentView.current;
    const point = anchor || { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const nextZoom = clampZoom(zoom), ratio = nextZoom / old.zoom;
    fitting.current = false;
    update({ zoom: nextZoom, x: point.x - (point.x - old.x) * ratio, y: point.y - (point.y - old.y) * ratio });
  }
  useLayoutEffect(() => {
    fit();
    const observer = new ResizeObserver(() => { if (fitting.current) fit(); });
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [doc.width, doc.height]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1);
      const step = Math.max(-100, Math.min(100, delta));
      zoomTo(currentView.current.zoom * Math.exp(-step * Math.log(1.05) / 100), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    fitting.current = false;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: currentView.current };
    setDragging(true); event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (start?.pointerId !== event.pointerId) return;
    update({ zoom: start.view.zoom, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const start = drag.current;
    if (event.type === 'pointerup' && event.button === 0 && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) {
      const rect = event.currentTarget.getBoundingClientRect(), view = currentView.current;
      const hit = hitDesignElement(doc, { x:(event.clientX-rect.left-view.x)/view.zoom,y:(event.clientY-rect.top-view.y)/view.zoom });
      onSelect?.(hit ? event.shiftKey ? selectedIds.includes(hit.id) ? selectedIds.filter(id=>id!==hit.id) : [...selectedIds,hit.id] : [hit.id] : []);
    }
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(currentView.current.zoom * 1.25); }
    if (event.key === '-') { event.preventDefault(); zoomTo(currentView.current.zoom / 1.25); }
    if (event.key === '0') { event.preventDefault(); fit(); }
    if (event.key === '1') { event.preventDefault(); zoomTo(1); }
  }
  return <>
    <div ref={viewport} tabIndex={0} role="region" aria-label="设计稿画布" className={`ui-design-viewport ${dragging ? 'dragging' : ''}`} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={keyDown}>
      <div className="ui-design-scene" data-zoom={view.zoom} style={{ width: doc.width, height: doc.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
        <div className="ui-design-board-label" style={{ transform: `scale(${1 / view.zoom})` }}>{name}<span>{doc.width} × {doc.height}</span></div>
        <DesignBoard doc={doc}/>
        {doc.elements.filter(element=>selectedIds.includes(element.id)).map(element=><div key={element.id} className="design-layer-selection" style={{left:element.x,top:element.y,width:element.width,height:element.height,outlineWidth:1.5/view.zoom,transform:`${element.importTransform?`matrix(${element.importTransform.join(',')},0,0) `:''}rotate(${element.rotation}deg)`}}/>)}
      </div>
    </div>
    <div className="ui-design-navigation"><span>点击选图层 · Shift 多选 · 滚轮缩放 · 拖动平移{selectedIds.length ? ` · 已选 ${selectedIds.length} 项` : ''}</span><div>
      <Tooltip title="缩小"><Button type="text" aria-label="缩小设计稿" icon={<MinusOutlined/>} disabled={view.zoom <= .01} onClick={() => zoomTo(currentView.current.zoom / 1.25)}/></Tooltip>
      <Select aria-label="设计稿缩放" value={view.zoom} onChange={value => zoomTo(value)} options={[...new Set([.1,.25,.5,.75,1,1.5,2,3,4,6,8,view.zoom])].sort((a,b)=>a-b).map(value=>({value,label:`${Math.round(value*100)}%`}))}/>
      <Tooltip title="放大"><Button type="text" aria-label="放大设计稿" icon={<PlusOutlined/>} disabled={view.zoom >= 8} onClick={() => zoomTo(currentView.current.zoom * 1.25)}/></Tooltip>
      <Button type="text" aria-label="设计稿原始大小" onClick={() => zoomTo(1)}>100%</Button>
      <Button type="text" aria-label="设计稿适应窗口" icon={<AimOutlined/>} onClick={fit}>适应窗口</Button>
    </div></div>
  </>;
}
