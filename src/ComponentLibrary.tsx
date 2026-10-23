import type { ReactNode } from 'react';
import { AppstoreOutlined, BorderOutlined, CalendarOutlined, CheckSquareOutlined, DownOutlined, FontSizeOutlined, FormOutlined, LayoutOutlined, MinusOutlined, PictureOutlined, TableOutlined, UnorderedListOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { antdCatalog, antdKinds, componentGroups, getComponentDefinition } from '../shared/antd-catalog';
import { basicKinds, elementKinds, kindNames, type ElementKind } from '../shared/model';

const groupIcons: Record<string, ReactNode> = { 通用: <AppstoreOutlined/>, 布局: <LayoutOutlined/>, 导航: <UnorderedListOutlined/>, 数据录入: <FormOutlined/>, 数据展示: <PictureOutlined/>, 反馈: <InfoCircleOutlined/> };
const special: Partial<Record<ElementKind, ReactNode>> = { rectangle: <BorderOutlined/>, ellipse: <span className="ellipse-icon"/>, text: <FontSizeOutlined/>, line: <MinusOutlined/>, button: <span className="button-icon">按钮</span>, input: <span className="input-icon">I</span>, select: <span className="select-icon"><span>请选择</span><DownOutlined/></span>, switch: <span className="switch-icon"/>, table: <TableOutlined/>, checkbox: <CheckSquareOutlined/>, datePicker: <CalendarOutlined/>, calendar: <CalendarOutlined/>, rangePicker: <CalendarOutlined/> };
export const elementSymbols = Object.fromEntries(elementKinds.map(kind => [kind, special[kind] || groupIcons[getComponentDefinition(kind)?.group || ''] || <AppstoreOutlined/>])) as Record<ElementKind, ReactNode>;
export function ComponentLibrary({ search, disabled, add }: { search: string; disabled: boolean; add: (kind: ElementKind) => void }) {
  const query = search.trim().toLowerCase();
  const matches = (kind: ElementKind) => `${kindNames[kind]} ${kind} ${getComponentDefinition(kind)?.component || ''} ${kind === 'select' ? '下拉框 下拉选择' : ''}`.toLowerCase().includes(query);
  const card = (kind: ElementKind) => <button key={kind} type="button" aria-label={kindNames[kind]} title={getComponentDefinition(kind)?.component || kindNames[kind]} className="element-card" data-element-kind={kind} disabled={disabled} draggable={!disabled} onDragStart={event => event.dataTransfer.setData('application/forma-element', kind)} onClick={() => add(kind)}><span className={`element-symbol ${kind}`}>{elementSymbols[kind]}</span><span>{kindNames[kind]}</span></button>;
  const basics = basicKinds.filter(matches);
  return <div className="component-library">
    {!!basics.length && <div className="library-section"><div className="section-label">基础元素 <span>{basics.length.toString().padStart(2, '0')}</span></div><div className="element-grid">{basics.map(card)}</div></div>}
    <div className="library-catalog-heading"><span>Ant Design</span><span>{antdKinds.filter(matches).length} 个组件</span></div>
    {componentGroups.map(group => { const kinds = antdKinds.filter(kind => antdCatalog[kind].group === group && matches(kind)); return !!kinds.length && <details className="component-group" key={group} open><summary><span>{group}</span><span>{kinds.length}<DownOutlined/></span></summary><div className="element-grid">{kinds.map(card)}</div></details>; })}
    {!elementKinds.some(matches) && <p className="library-no-results">没有找到相关组件</p>}
  </div>;
}
