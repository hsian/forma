import { RichText } from './RichText';
import { DrawingView } from './DrawingView';
import { roundedRectanglePath, vectorRectangleRadii } from '../shared/vector';
import { Button, Input, Select, Switch, Table, Tag } from 'antd';
import { getSelectConfig, type PrototypeElement, type TableRowAction } from '../shared/model';
import { tableRows, tableColumns, rowActions, rowText, type RuntimeValue, type RuntimeValues } from '../shared/runtime';
import { ChoiceView } from './ChoiceView';
import { AntdElement } from './AntdElement';
import { componentConfig } from '../shared/antd-catalog';

const members = [
  { key: '1', name: '林晓', email: 'lin.xiao@example.com', role: '管理员', status: '正常', date: '2026-10-20' },
  { key: '2', name: '陈一', email: 'chen.yi@example.com', role: '编辑者', status: '正常', date: '2026-10-19' },
  { key: '3', name: '周予', email: 'zhou.yu@example.com', role: '编辑者', status: '正常', date: '2026-10-18' },
  { key: '4', name: '许安', email: 'xu.an@example.com', role: '访客', status: '停用', date: '2026-10-16' },
];
function ElementBody({ element: e, preview = false, activate, value, onChange, values = {}, applied = {}, notify, onRowAction }: { element: PrototypeElement; preview?: boolean; activate?: (e: PrototypeElement) => void; value?: RuntimeValue; onChange?: (value: RuntimeValue) => void; values?: RuntimeValues; applied?: RuntimeValues; notify?: (text: string) => void; onRowAction?: (table: PrototypeElement, action: TableRowAction, rowIndex: number) => void }) {
  const common = { width: '100%', height: '100%', fontSize: e.fontSize, color: e.color, borderRadius: e.radius };
  const config = componentConfig(e.kind, e.component);
  if(e.drawing && ['rectangle','ellipse','vector'].includes(e.kind)) return <DrawingView element={e}/>;
  switch (e.kind) {
    case 'rectangle': case 'ellipse': return <div style={{ ...common, background: e.fill, border: `${e.strokeWidth}px solid ${e.stroke}`, borderRadius: e.kind === 'ellipse' ? '50%' : e.radius }} />;
    case 'vector': return e.vector ? <svg width="100%" height="100%" viewBox={` 0 0 ${e.vector.viewWidth} ${e.vector.viewHeight}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}><path d={vectorRectangleRadii(e) ? roundedRectanglePath(e.vector.viewWidth,e.vector.viewHeight,vectorRectangleRadii(e)!) : e.vector.path} fill={e.vector.fillEnabled ? e.fill : 'none'} fillOpacity={e.vector.fillOpacity} fillRule={e.vector.fillRule} stroke={e.strokeWidth ? e.stroke : 'none'} strokeWidth={e.strokeWidth} strokeOpacity={e.vector.strokeOpacity}/></svg> : null;
    case 'line': return <svg width="100%" height="100%" style={{ display: 'block', overflow: 'visible' }}><line x1="0" y1="50%" x2="100%" y2="50%" stroke={e.stroke} strokeWidth={Math.max(1, e.strokeWidth)} /></svg>;
    case 'text': {
      if (!e.typography) return <div className="text-content" style={{ ...common, whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}>{e.text}</div>;
      const t=e.typography;
      // Legacy imports also benefit without reimporting or changing stored text.
      const singleLine=t.wrap ? t.wrap==='nowrap' : !/[\r\n]/.test(e.text) && e.height<=e.fontSize*1.8;
      return <div className="imported-text" style={{ ...common, display:'flex', flexDirection:'column', justifyContent:t.verticalAlign==='middle'?'center':t.verticalAlign==='bottom'?'flex-end':'flex-start', overflow:'visible' }}><div className="text-content" style={{ display:'block', flexShrink:0, width:'100%', height:'auto', whiteSpace:singleLine?'pre':'pre-wrap', overflowWrap:'normal', wordBreak:'normal', fontFamily:t.fontFamily, fontWeight:t.fontWeight, fontStyle:t.fontStyle, fontSynthesis:'weight style', letterSpacing:t.letterSpacing ?? 0, textAlign:t.align, lineHeight:`${t.wrap ? t.lineHeight : singleLine ? e.height : t.lineHeight}px` }}><RichText element={e}/></div></div>;
    }
    case 'button': {
      const plain = config.type === 'text' || config.type === 'link';
      return <Button type={config.type as 'default'} disabled={config.disabled === true} loading={config.loading === true} danger={config.danger === true} size={config.size as 'middle' | undefined} style={{ ...common, background: plain ? 'transparent' : config.danger ? '#ff4d4f' : e.fill, color: plain ? config.danger ? '#ff4d4f' : e.fill : e.color, borderColor: plain ? 'transparent' : e.strokeWidth ? e.stroke : 'transparent', borderWidth: plain ? 0 : e.strokeWidth, borderStyle: config.type === 'dashed' ? 'dashed' : undefined }} onClick={event => { event.stopPropagation(); activate?.(e); }}>{e.text}</Button>;
    }
    case 'input': return <Input aria-label={e.name} placeholder={e.text} disabled={config.disabled === true} allowClear={config.allowClear === true} size={config.size as 'middle' | undefined} value={typeof value === 'string' ? value : undefined} onChange={event => onChange?.(event.target.value)} style={{ ...common, background: e.fill }} />;
    case 'tabs': case 'tree': case 'checkbox': return <div style={{ ...common, overflow: 'auto', background: e.fill }}><ChoiceView element={e} value={value} onChange={onChange}/></div>;
    case 'select': {
      const config = getSelectConfig(e);
      return <Select key={JSON.stringify(config)} aria-label={e.name} placeholder={e.text} style={common}
        options={config.options.map(option => ({ value: option.id, label: option.label || '未命名选项' }))}
        mode={config.multiple ? 'multiple' : undefined} defaultValue={config.multiple ? config.defaultValues : config.defaultValues[0]}
        {...(value !== undefined ? { value: value || undefined } : {})} onChange={next => onChange?.(next || '')}
        allowClear={config.allowClear} disabled={config.disabled} virtual={false} maxTagCount="responsive"
        getPopupContainer={trigger => trigger.parentElement!} />;
    }
    case 'switch': return <Switch key={JSON.stringify(config)} aria-label={e.name} defaultChecked={config.checked !== false} {...(value !== undefined ? { checked: value === 'true' } : {})} disabled={config.disabled === true} loading={config.loading === true} checkedChildren={String(config.checkedChildren || '')} unCheckedChildren={String(config.unCheckedChildren || '')} onChange={next => onChange?.(String(next))}/>;
    case 'table': if (e.table) {
      const rows = tableRows(e, values, applied);
      const actions = rowActions(e.table);
      const rowClick = (row: Record<string, string>) => notify?.(rowText(e.table?.rowMessage || '已选择此行', row));
      return <div className="prototype-table" style={{ width: '100%', height: '100%', overflow: 'auto', background: e.fill, borderRadius: e.radius }}><Table key={JSON.stringify([values, applied, e.table.pageSize])} size="small" rowKey="__rowKey" dataSource={rows.map(row => ({ ...row, __rowKey: String(e.table!.rows.indexOf(row)) }))} scroll={{ x: 'max-content' }} pagination={{ pageSize: e.table.pageSize, size: 'small', showSizeChanger: false, showTotal: total => `共 ${total} 条` }} onRow={preview ? record => ({ onClick: () => rowClick(record), style: { cursor: 'pointer' } }) : undefined} columns={[
        ...tableColumns(e, values).map(column => ({ title: column.title, dataIndex: column.key, width: column.width || 140 })),
        ...(actions.length ? [{ title: '操作', key: '__action', width: Math.max(80, actions.length * 64), fixed: 'right' as const, render: (_: unknown, record: Record<string, string>) => <>{actions.map(action => <Button key={action.id} type="link" size="small" onClick={event => { event.stopPropagation(); if (!preview) return; onRowAction?.(e, action, Number(record.__rowKey)); }}>{action.label}</Button>)}</> }] : []),
      ]}/></div>;
    }
    return <div className="prototype-table" style={{ width: '100%', height: '100%', overflow: 'hidden', background: e.fill, borderRadius: e.radius }}><Table size="small" dataSource={members} pagination={preview ? { pageSize: 4, size: 'small', showTotal: total => `共 ${total} 位成员` } : false} columns={[
      { title: '成员姓名', dataIndex: 'name', render: (name: string) => <span className="member"><span className="avatar">{name[0]}</span>{name}</span> },
      { title: '邮箱', dataIndex: 'email' }, { title: '角色', dataIndex: 'role' },
      { title: '状态', dataIndex: 'status', render: (status: string) => <Tag bordered={false} color={status === '正常' ? 'success' : 'default'}>{status}</Tag> },
      { title: '加入时间', dataIndex: 'date' },
    ]} /></div>;
    default: return <AntdElement key={JSON.stringify(e.component)} element={e} preview={preview} value={value} onChange={onChange} activate={activate} notify={notify}/>;
  }
}

export function ElementView(props:Parameters<typeof ElementBody>[0]) {
 let node=<ElementBody {...props}/>;
 for(const [index,path] of (props.element.clipPaths||[]).entries())node=<div key={index} style={{width:'100%',height:'100%',clipPath:`path(${props.element.clipRules?.[index]||'nonzero'}, "${path}")`}}>{node}</div>;
 return node;
}
