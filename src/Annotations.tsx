import { useEffect, useRef, type CSSProperties } from 'react';
import { App, Button, Empty, Input, Popover, Switch } from 'antd';
import { CommentOutlined, DeleteOutlined, EnvironmentOutlined, PlusOutlined } from '@ant-design/icons';
import type { PrototypeAnnotation } from '../shared/model';
import './annotations.css';

interface LayerProps {
  annotations: PrototypeAnnotation[]; visible: boolean; selectedId?: string | null;
  focusId?: string; placing?: boolean; panning?: boolean; pinScale?: number; style?: CSSProperties;
  onPlace?: (point: { x: number; y: number }) => void; onSelect?: (id: string) => void;
}
export function AnnotationLayer({ annotations, visible, selectedId, focusId, placing, panning, pinScale = 1, style, onPlace, onSelect }: LayerProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (visible && focusId) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })); }, [visible, focusId]);
  if (!visible) return null;
  return <div ref={root} className={`annotation-layer ${placing && !panning ? 'is-placing' : ''} ${panning ? 'is-panning' : ''}`} style={style} aria-label="原型标注层"
    onMouseDown={event => { if (placing || (event.target as HTMLElement).closest('.annotation-pin')) event.stopPropagation(); }}
    onClick={event => {
      if (!placing || panning || (event.target as HTMLElement).closest('.annotation-pin')) return;
      event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width && rect.height) onPlace?.({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
    }}>
    {annotations.map(note => {
      const pin = <button key={note.id} type="button" className={`annotation-pin ${selectedId === note.id ? 'is-selected' : ''}`} data-annotation-id={note.id} data-number={note.number} aria-label={`标注 ${note.number}：${note.title || '未命名'}`} aria-pressed={onSelect ? selectedId === note.id : undefined} style={{ left: `clamp(${14 * pinScale}px, ${note.x * 100}%, calc(100% - ${14 * pinScale}px))`, top: `clamp(${14 * pinScale}px, ${note.y * 100}%, calc(100% - ${14 * pinScale}px))`, transform: `translate(-50%, -50%) scale(${pinScale})` }} onClick={event => { event.stopPropagation(); onSelect?.(note.id); }}>{note.number}</button>;
      return onSelect ? pin : <Popover key={note.id} trigger="click" defaultOpen={note.id === focusId} title={`标注 ${note.number} · ${note.title || '未命名'}`} content={<div className="annotation-popover-content">{note.content || '尚未填写说明'}</div>}>{pin}</Popover>;
    })}
  </div>;
}

interface PanelProps {
  annotations: PrototypeAnnotation[]; selectedId: string | null; canEdit: boolean; visible: boolean;
  placing: boolean; total: number; dialog: boolean;
  onVisible: (visible: boolean) => void; onAdd: () => void; onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Pick<PrototypeAnnotation, 'title' | 'content'>>) => void;
  onDelete: (id: string) => void; onReposition: (id: string) => void; onCancel: () => void;
}
export function AnnotationPanel(props: PanelProps) {
  const { modal } = App.useApp();
  const active = props.annotations.find(note => note.id === props.selectedId);
  return <div className="annotation-panel"><div className="annotation-panel-heading"><span className="purple-icon"><CommentOutlined/></span><div><strong>{props.dialog ? '弹窗标注' : '页面标注'}</strong><span>独立说明层 · {props.annotations.length} 条</span></div><Switch size="small" aria-label="显示标注层" checked={props.visible} onChange={props.onVisible}/></div>
    <div className="annotation-panel-body"><p className="annotation-help">为页面位置添加说明，标注随原型版本保存。预览时可单独开启查看。</p>
      {props.placing ? <div className="annotation-placement-hint" role="status"><EnvironmentOutlined/><span>点击画布放置标注<br/>按 Esc 可取消</span><Button type="text" size="small" onClick={props.onCancel}>取消</Button></div> : <Button block type="primary" aria-label="添加标注" icon={<PlusOutlined/>} disabled={!props.canEdit || props.total >= 500} onClick={props.onAdd}>添加标注</Button>}
      {!props.canEdit && <p className="annotation-readonly">当前仅可查看标注，修改需要原型编辑权限和页面编辑权。</p>}
      {props.total >= 500 && <p className="annotation-readonly">每页最多保存 500 条标注（含弹窗）。</p>}
      {active && <section className="annotation-editor"><div className="annotation-editor-heading"><span className="annotation-number">{active.number}</span><strong>标注说明</strong><Button type="text" size="small" danger aria-label="删除当前标注" disabled={!props.canEdit} icon={<DeleteOutlined/>} onClick={() => modal.confirm({ title: `删除标注 ${active.number}？`, content: '删除后可通过撤销恢复。', okText: '删除标注', cancelText: '取消', okButtonProps: { danger: true }, onOk: () => props.onDelete(active.id) })}/></div><label>标题<Input aria-label="标注标题" placeholder="例如：手机号校验规则" maxLength={120} disabled={!props.canEdit} value={active.title} onChange={event => props.onChange(active.id, { title: event.target.value })}/></label><label>说明<Input.TextArea aria-label="标注说明" placeholder="描述业务规则、交互细节或待确认事项…" maxLength={5000} showCount autoSize={{ minRows: 5, maxRows: 12 }} disabled={!props.canEdit} value={active.content} onChange={event => props.onChange(active.id, { content: event.target.value })}/></label><Button size="small" icon={<EnvironmentOutlined/>} disabled={!props.canEdit} onClick={() => props.onReposition(active.id)}>重新定位</Button><span className="annotation-auto-save">随页面自动保存</span></section>}
      <div className="annotation-list-heading">{props.dialog ? '当前弹窗的标注' : '当前页面的标注'}<span>{props.annotations.length}</span></div>
      {!props.annotations.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有标注，点击添加后在画布选择位置"/> : <div className="annotation-list">{props.annotations.map(note => <button key={note.id} className={note.id === props.selectedId ? 'selected' : ''} onClick={() => props.onSelect(note.id)} aria-label={`查看标注 ${note.number}`}><span className="annotation-number">{note.number}</span><span><strong>{note.title || '未命名标注'}</strong><small>{note.content || '尚未填写说明'}</small></span></button>)}</div>}
    </div>
  </div>;
}
