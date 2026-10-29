import { useEffect, useState } from 'react';
import { App, Button, Dropdown, Empty, Input, Modal, Spin, Tooltip } from 'antd';
import { DeleteOutlined, EditOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { captureComponent, type PersonalComponent } from '../shared/personal-components';
import type { PrototypeDocument } from '../shared/model';
import { initialValues } from '../shared/runtime';
import { ElementView } from './ElementView';
import { useEditor } from './store';
import './personal-components.css';

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.message || '操作失败，请重试');
  return result;
}

function ComponentPreview({ document: doc }: { document: PrototypeDocument }) {
  const scale = Math.min(1, 204 / doc.width, 100 / doc.height);
  return <div className="personal-component-preview" aria-hidden="true"><div style={{ width: doc.width * scale, height: doc.height * scale }}><div className="personal-component-surface" style={{ width: doc.width, height: doc.height, transform: `scale(${scale})` }}>{doc.elements.filter(element => !element.parentId && !element.hidden).map(element => <div key={element.id} className="node-content" style={{ position: 'absolute', left: element.x, top: element.y, width: element.width, height: element.height, opacity: element.opacity, transform: `${element.importTransform ? `matrix(${element.importTransform.join(',')},0,0) ` : ''}rotate(${element.rotation}deg)` }}><ElementView element={element} values={initialValues(doc)}/></div>)}</div></div></div>;
}

export function PersonalComponents({ search, disabled, saveOpen, setSaveOpen, insert }: { search: string; disabled: boolean; saveOpen: boolean; setSaveOpen: (open: boolean) => void; insert: (component: PersonalComponent, x?: number, y?: number) => void }) {
  const { message, modal } = App.useApp();
  const selected = useEditor(state => state.selected);
  const [components, setComponents] = useState<PersonalComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [snapshot, setSnapshot] = useState<PrototypeDocument | null>(null);
  const [renaming, setRenaming] = useState<PersonalComponent | null>(null);
  async function load() {
    setLoading(true); setError('');
    try { setComponents((await request<{ components: PersonalComponent[] }>('/api/me/components')).components); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!saveOpen) return;
    try {
      const state = useEditor.getState();
      setSnapshot(captureComponent(state.doc, state.selected));
      setName(state.selected.length === 1 ? state.doc.elements.find(element => element.id === state.selected[0])?.name || '' : '新建组件');
    } catch (error) { void message.warning((error as Error).message); setSaveOpen(false); }
  }, [saveOpen]);
  async function save() {
    if (!name.trim() || !(renaming || snapshot)) return;
    setBusy(true);
    try {
      const item = await request<PersonalComponent>(`/api/me/components${renaming ? `/${renaming.id}` : ''}`, renaming ? 'PUT' : 'POST', { name: name.trim(), document: renaming?.document || snapshot, ...(renaming ? { revision: renaming.revision } : {}) });
      setComponents(items => [item, ...items.filter(existing => existing.id !== item.id)]);
      setSaveOpen(false); setRenaming(null);
      void message.success(renaming ? '组件已重命名' : '已保存到我的组件');
    } catch (error) { void message.error((error as Error).message); }
    finally { setBusy(false); }
  }
  function update(component: PersonalComponent) {
    let document: PrototypeDocument;
    try { const state = useEditor.getState(); document = captureComponent(state.doc, state.selected); }
    catch (error) { void message.warning((error as Error).message); return; }
    modal.confirm({ title: `更新「${component.name}」？`, content: '使用当前选中的元素替换模板。以后插入时使用新样式，已有页面保持原样。', okText: '更新组件', cancelText: '取消', onOk: async () => {
      try {
        const item = await request<PersonalComponent>(`/api/me/components/${component.id}`, 'PUT', { name: component.name, document, revision: component.revision });
        setComponents(items => [item, ...items.filter(existing => existing.id !== item.id)]); void message.success('组件已更新');
      } catch (error) { void message.error((error as Error).message); throw error; }
    } });
  }
  function remove(component: PersonalComponent) {
    modal.confirm({ title: `删除「${component.name}」？`, content: '已有页面中插入的元素会保留。', okText: '删除', okButtonProps: { danger: true }, cancelText: '取消', onOk: async () => {
      try { await request(`/api/me/components/${component.id}`, 'DELETE'); setComponents(items => items.filter(item => item.id !== component.id)); }
      catch (error) { void message.error((error as Error).message); throw error; }
    } });
  }
  const filtered = components.filter(component => component.name.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="personal-components">
    <div className="personal-components-actions"><Tooltip title="请选中页面的元素保存为我的组件"><span className="personal-component-save"><Button icon={<SaveOutlined/>} disabled={disabled || !selected.length} onClick={() => setSaveOpen(true)}>保存选中元素</Button></span></Tooltip><Button aria-label="刷新我的组件" title="刷新我的组件" icon={<ReloadOutlined/>} loading={loading} onClick={() => void load()}/></div>
    {loading ? <div className="personal-components-loading"><Spin/></div> : error ? <div role="alert"><p>{error}</p><Button onClick={() => void load()}>重试</Button></div> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? '没有找到相关组件' : '选中画布上的元素，保存为你的第一个组件'}/> : filtered.map(component => <article className="personal-component-card" key={component.id} data-personal-component={component.id}>
      <div role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} className="personal-component-insert" aria-label={`插入组件 ${component.name}`} draggable={!disabled} onDragStart={event => event.dataTransfer.setData('application/forma-personal-component', JSON.stringify(component))} onKeyDown={event => { if (!disabled && ['Enter', ' '].includes(event.key)) { event.preventDefault(); insert(component); } }} onClick={() => { if (!disabled) insert(component); }}><ComponentPreview document={component.document}/></div>
      <div className="personal-component-heading"><strong title={component.name}>{component.name}</strong><div className="personal-component-actions"><Dropdown trigger={['click']} menu={{ items: [{ key: 'rename', label: '重命名' }, { key: 'update', label: '用选中元素更新', disabled: disabled || !selected.length }], onClick: ({ key }) => { if (key === 'update') update(component); else { setRenaming(component); setName(component.name); } } }}><Button type="text" size="small" title="修改" aria-label={`修改组件 ${component.name}`} icon={<EditOutlined/>}/></Dropdown><Button type="text" size="small" title="删除" aria-label={`删除组件 ${component.name}`} icon={<DeleteOutlined/>} onClick={() => remove(component)}/></div></div>
    </article>)}
    <Modal title={renaming ? '重命名组件' : '保存到我的组件'} open={saveOpen || !!renaming} confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }} okButtonProps={{ disabled: !name.trim() }} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={() => { if (!busy) { setSaveOpen(false); setRenaming(null); } }}>
      <label className="personal-component-name">组件名称<Input aria-label="组件名称" autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} onPressEnter={() => { if (!busy) void save(); }} placeholder="例如：通用筛选表单、操作按钮组"/></label>
      {!renaming && snapshot && <ComponentPreview document={snapshot}/>}
      <p className="personal-components-note">保存在你的个人组件库中，之后可在任意页面重复插入。</p>
    </Modal>
  </div>;
}
