import { Button, Input, InputNumber, Select, Switch } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { componentConfig, getComponentDefinition, type ComponentConfig, type ComponentItem, type ComponentValue } from '../shared/antd-catalog';
import type { PrototypeElement } from '../shared/model';

export function AntdProperties({ element: e, patch }: { element: PrototypeElement; patch: (id: string, patch: Partial<PrototypeElement>) => void }) {
  const definition = getComponentDefinition(e.kind);
  if (!definition?.fields.length) return null;
  const config = componentConfig(e.kind, e.component);
  const update = (key: string, value: ComponentValue) => {
    const next: ComponentConfig = { ...e.component, [key]: value };
    if (key === 'min' && typeof value === 'number' && typeof config.max === 'number' && value > config.max) next.max = value;
    if (key === 'max' && typeof value === 'number' && typeof config.min === 'number' && value < config.min) next.min = value;
    patch(e.id, { component: next });
  };
  return <div className="antd-properties"><strong>{definition.component} 设置</strong>{definition.fields.map(field => {
    const value = config[field.key];
    const label = `${definition.component} ${field.label}`;
    if (field.type === 'boolean') return <div className="visibility-row" key={field.key}><span>{field.label}</span><Switch size="small" aria-label={label} checked={value === true} onChange={next => update(field.key, next)}/></div>;
    if (field.type === 'items') return <ItemProperties key={field.key} kind={e.kind} items={Array.isArray(value) ? value : []} change={next => {
      const component = { ...e.component, [field.key]: next };
      if (typeof config.value === 'string' && !next.some(item => item.id === config.value)) component.value = next[0]?.id || '';
      patch(e.id, { component });
    }}/>;
    return <label key={field.key} className="stacked-label">{field.label}{field.type === 'option' ? <Select aria-label={label} allowClear value={typeof value === 'string' && value ? value : undefined} placeholder="不预选" options={(Array.isArray(config.items) ? config.items : []).map(item => ({ label: item.label, value: item.id }))} onChange={next => update(field.key, next || '')}/>
      : field.type === 'select' ? <Select aria-label={label} value={typeof value === 'string' ? value : undefined} placeholder="默认" options={field.options} onChange={next => update(field.key, next)}/>
      : field.type === 'number' ? <InputNumber aria-label={label} min={field.min} max={field.max} value={typeof value === 'number' ? value : undefined} onChange={next => next !== null && update(field.key, next)}/>
      : field.type === 'color' ? <input type="color" aria-label={label} value={typeof value === 'string' ? value : '#635bff'} onChange={event => update(field.key, event.target.value)}/>
      : field.type === 'textarea' ? <Input.TextArea aria-label={label} autoSize={{ minRows: 2, maxRows: 6 }} value={typeof value === 'string' ? value : ''} onChange={event => update(field.key, event.target.value)}/>
      : <Input aria-label={label} value={typeof value === 'string' ? value : ''} onChange={event => update(field.key, event.target.value)}/>}</label>;
  })}{['upload', 'form', 'message', 'notification'].includes(e.kind) && <p className="property-note">交互在预览中体验，使用模拟数据。</p>}{['flex', 'grid', 'space', 'layout', 'splitter'].includes(e.kind) && <p className="property-note">通过条目和属性编辑容器示意；画布上的其他元素仍可独立摆放。</p>}</div>;
}
function ItemProperties({ kind, items, change }: { kind: string; items: ComponentItem[]; change: (items: ComponentItem[]) => void }) {
  const component = getComponentDefinition(kind)!.component;
  const hierarchical = kind === 'treeSelect' || kind === 'cascader';
  const update = (id: string, patch: Partial<ComponentItem>) => change(items.map(item => item.id === id ? { ...item, ...patch } : item));
  const move = (index: number, delta: number) => { const next = [...items]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(next); };
  return <div className="antd-item-properties"><div className="select-options-heading"><strong>条目</strong><span>{items.length} 项</span></div>{items.map((item, index) => <div className="antd-item-property" key={item.id}><div className="property-inline"><Input aria-label={`${component} 条目 ${index + 1} 名称`} value={item.label} onChange={event => update(item.id, { label: event.target.value })}/><Button size="small" aria-label={`${component} 删除条目 ${index + 1}`} icon={<DeleteOutlined/>} onClick={() => change(items.filter(other => other.id !== item.id).map(other => other.parentId === item.id ? { ...other, parentId: item.parentId } : other))}/></div><Input.TextArea aria-label={`${component} 条目 ${index + 1} 说明`} placeholder="内容或说明" autoSize={{ minRows: 1, maxRows: 3 }} value={item.description || ''} onChange={event => update(item.id, { description: event.target.value })}/>{hierarchical && <Select size="small" aria-label={`${component} 条目 ${index + 1} 上级`} allowClear placeholder="根节点" value={item.parentId} options={items.filter(other => { const seen = new Set([item.id]); let current: ComponentItem | undefined = other; while (current) { if (seen.has(current.id)) return false; seen.add(current.id); current = items.find(option => option.id === current?.parentId); } return true; }).map(other => ({ label: other.label, value: other.id }))} onChange={parentId => update(item.id, { parentId })}/>}<div className="antd-item-order"><span>{index + 1}</span><Button type="text" size="small" disabled={index === 0} aria-label={`${component} 上移条目 ${index + 1}`} icon={<ArrowUpOutlined/>} onClick={() => move(index, -1)}/><Button type="text" size="small" disabled={index === items.length - 1} aria-label={`${component} 下移条目 ${index + 1}`} icon={<ArrowDownOutlined/>} onClick={() => move(index, 1)}/></div></div>)}<Button size="small" block icon={<PlusOutlined/>} aria-label={`${component} 添加条目`} onClick={() => change([...items, { id: crypto.randomUUID(), label: '新条目', description: '' }])}>添加条目</Button></div>;
}
