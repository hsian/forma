import { Button, Input, Select, Switch, Table, Tag } from 'antd';
import { getSelectConfig, type PrototypeElement } from '../shared/model';

const members = [
  { key: '1', name: '林晓', email: 'lin.xiao@example.com', role: '管理员', status: '正常', date: '2026-10-20' },
  { key: '2', name: '陈一', email: 'chen.yi@example.com', role: '编辑者', status: '正常', date: '2026-10-19' },
  { key: '3', name: '周予', email: 'zhou.yu@example.com', role: '编辑者', status: '正常', date: '2026-10-18' },
  { key: '4', name: '许安', email: 'xu.an@example.com', role: '访客', status: '停用', date: '2026-10-16' },
];
export function ElementView({ element: e, preview = false, activate, value, onChange }: { element: PrototypeElement; preview?: boolean; activate?: (e: PrototypeElement) => void; value?: string; onChange?: (value: string) => void }) {
  const common = { width: '100%', height: '100%', fontSize: e.fontSize, color: e.color, borderRadius: e.radius };
  switch (e.kind) {
    case 'rectangle': case 'ellipse': return <div style={{ ...common, background: e.fill, border: `${e.strokeWidth}px solid ${e.stroke}`, borderRadius: e.kind === 'ellipse' ? '50%' : e.radius }} />;
    case 'line': return <svg width="100%" height="100%" style={{ overflow: 'visible' }}><line x1="0" y1="50%" x2="100%" y2="50%" stroke={e.stroke} strokeWidth={Math.max(1, e.strokeWidth)} /></svg>;
    case 'text': return <div className="text-content" style={{ ...common, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.text}</div>;
    case 'button': return <Button style={{ ...common, background: e.fill, borderColor: e.strokeWidth ? e.stroke : 'transparent', borderWidth: e.strokeWidth }} onClick={event => { event.stopPropagation(); activate?.(e); }}>{e.text}</Button>;
    case 'input': return <Input aria-label={e.name} placeholder={e.text} value={value} onChange={event => onChange?.(event.target.value)} style={{ ...common, background: e.fill }} />;
    case 'select': {
      const config = getSelectConfig(e);
      return <Select key={JSON.stringify(config)} aria-label={e.name} placeholder={e.text} style={common}
        options={config.options.map(option => ({ value: option.id, label: option.label || '未命名选项' }))}
        mode={config.multiple ? 'multiple' : undefined} defaultValue={config.multiple ? config.defaultValues : config.defaultValues[0]}
        allowClear={config.allowClear} disabled={config.disabled} virtual={false} maxTagCount="responsive"
        getPopupContainer={trigger => trigger.parentElement!} />;
    }
    case 'switch': return <Switch aria-label={e.name} defaultChecked />;
    case 'table': return <div className="prototype-table" style={{ width: '100%', height: '100%', overflow: 'hidden', background: e.fill, borderRadius: e.radius }}><Table size="small" dataSource={members} pagination={preview ? { pageSize: 4, size: 'small', showTotal: total => `共 ${total} 位成员` } : false} columns={[
      { title: '成员姓名', dataIndex: 'name', render: (name: string) => <span className="member"><span className="avatar">{name[0]}</span>{name}</span> },
      { title: '邮箱', dataIndex: 'email' }, { title: '角色', dataIndex: 'role' },
      { title: '状态', dataIndex: 'status', render: (status: string) => <Tag bordered={false} color={status === '正常' ? 'success' : 'default'}>{status}</Tag> },
      { title: '加入时间', dataIndex: 'date' },
    ]} /></div>;
  }
}
