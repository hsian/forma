import { Button, Input, Select, Switch } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { getSelectConfig, normalizeSelectConfig, type PrototypeElement, type SelectConfig } from '../shared/model';

export function SelectProperties({ element, patch }: { element: PrototypeElement; patch: (id: string, patch: Partial<PrototypeElement>) => void }) {
  const config = getSelectConfig(element);
  const update = (next: Partial<SelectConfig>) => patch(element.id, { select: normalizeSelectConfig({ ...config, ...next }) });
  function move(index: number, offset: number) {
    const options = [...config.options];
    const target = index + offset;
    if (target < 0 || target >= options.length) return;
    [options[index], options[target]] = [options[target], options[index]];
    update({ options });
  }
  return <div className="select-properties">
    <div className="select-options-heading"><strong>选项列表</strong><span>{config.options.length} 项</span></div>
    <div className="select-option-list">{config.options.map((option, index) => <div className="select-option-row" key={option.id}>
      <span className="option-index">{index + 1}</span>
      <Input aria-label={`选项 ${index + 1} 名称`} placeholder="选项名称" value={option.label} onChange={e => update({ options: config.options.map(item => item.id === option.id ? { ...item, label: e.target.value } : item) })}/>
      <div className="option-row-actions">
        <button type="button" aria-label={`上移选项 ${index + 1}`} title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpOutlined/></button>
        <button type="button" aria-label={`下移选项 ${index + 1}`} title="下移" disabled={index === config.options.length - 1} onClick={() => move(index, 1)}><ArrowDownOutlined/></button>
        <button type="button" aria-label={`删除选项 ${index + 1}`} title="删除" onClick={() => update({ options: config.options.filter(item => item.id !== option.id) })}><DeleteOutlined/></button>
      </div>
    </div>)}</div>
    {!config.options.length && <p className="property-note">还没有选项，添加后即可在预览中选择。</p>}
    <Button block size="small" icon={<PlusOutlined/>} aria-label="添加选项" onClick={() => update({ options: [...config.options, { id: crypto.randomUUID(), label: `选项${config.options.length + 1}` }] })}>添加选项</Button>
    <label className="stacked-label">默认选中项<Select
      key={config.multiple ? 'multiple' : 'single'} aria-label="默认选中项" placeholder="不预选" virtual={false} allowClear
      mode={config.multiple ? 'multiple' : undefined}
      value={config.multiple ? config.defaultValues : config.defaultValues[0]}
      options={config.options.map(option => ({ value: option.id, label: option.label || '未命名选项' }))}
      onChange={(value: string | string[] | undefined) => update({ defaultValues: Array.isArray(value) ? value : value ? [value] : [] })}
    /></label>
    <div className="visibility-row"><span>多选模式</span><Switch aria-label="多选模式" size="small" checked={config.multiple} onChange={multiple => update({ multiple })}/></div>
    <div className="visibility-row"><span>允许清空</span><Switch aria-label="允许清空" size="small" checked={config.allowClear} onChange={allowClear => update({ allowClear })}/></div>
    <div className="visibility-row"><span>禁用控件</span><Switch aria-label="禁用控件" size="small" checked={config.disabled} onChange={disabled => update({ disabled })}/></div>
  </div>;
}
