import { useState } from 'react';
import { Checkbox, Input, Tabs, Tree, Empty } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { PrototypeElement } from '../shared/model';
import type { RuntimeValue } from '../shared/runtime';
import { componentConfig } from '../shared/antd-catalog';

export function ChoiceView({ element: e, value, onChange }: { element: PrototypeElement; value?: RuntimeValue; onChange?: (value: RuntimeValue) => void }) {
  const [search, setSearch] = useState('');
  const options = e.choices?.options || [];
  const defaults = e.choices?.defaultValues || [];
  const config = componentConfig(e.kind, e.component);
  if (e.kind === 'tabs') return <Tabs className="prototype-tabs" type={config.type as 'line'} tabPosition={config.tabPosition as 'top'} activeKey={typeof value === 'string' ? value : defaults[0]} items={options.map(o => ({ key: o.id, label: o.label }))} onChange={onChange}/>;
  if (e.kind === 'checkbox') {
    const checked = Array.isArray(value) ? value : defaults;
    const all = options.length > 0 && options.every(o => checked.includes(o.id));
    return <div className="prototype-checkbox"><Checkbox checked={all} indeterminate={!all && checked.length > 0} onChange={event => onChange?.(event.target.checked ? options.map(o => o.id) : [])}>全选</Checkbox><Checkbox.Group aria-label={e.name} value={checked} options={options.map(o => ({ label: o.label, value: o.id }))} onChange={onChange}/></div>;
  }
  const visible = new Set(options.filter(o => o.label.includes(search)).map(o => o.id));
  for (const id of [...visible]) {
    const seen = new Set<string>(); let item = options.find(o => o.id === id);
    while (item?.parentId && !seen.has(item.parentId)) { seen.add(item.parentId); visible.add(item.parentId); item = options.find(o => o.id === item?.parentId); }
  }
  const nodes = (parentId?: string, ancestors = new Set<string>()): DataNode[] => options.filter(o => o.parentId === parentId && visible.has(o.id) && !ancestors.has(o.id)).map(o => ({ key: o.id, title: o.label, children: nodes(o.id, new Set([...ancestors, o.id])) }));
  return <div className="prototype-tree"><Input.Search aria-label={`${e.name}搜索`} placeholder="搜索组织机构" value={search} onChange={event => setSearch(event.target.value)} allowClear/>{visible.size ? <Tree key={search ? `search-${search}` : 'all'} defaultExpandAll treeData={nodes()} selectedKeys={[typeof value === 'string' ? value : defaults[0]]} onSelect={keys => onChange?.(String(keys[0] || ''))}/> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配节点"/>}</div>;
}
