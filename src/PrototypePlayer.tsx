import { useEffect, useState, type CSSProperties } from 'react';
import { App, Form, Modal } from 'antd';
import { ElementView } from './ElementView';
import type { PrototypeDocument, PrototypeElement, TableRowAction } from '../shared/model';
import { initialValues, isFormControl, matches, rowText, rowDraft, updateMockRow, type RowContext, type RuntimeValue, type RuntimeValues } from '../shared/runtime';

function elementStyle(e: PrototypeElement): CSSProperties {
  return { position: 'absolute', left: e.x, top: e.y, width: e.width, height: e.height, transform: `${e.importTransform ? `matrix(${e.importTransform.join(',')},0,0) ` : ''}rotate(${e.rotation}deg)`, opacity: e.opacity };
}
export function PrototypePlayer({ doc, initialDialogId }: { doc: PrototypeDocument; initialDialogId?: string }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [modalId, setModalId] = useState<string | null>(initialDialogId || null);
  const [values, setValues] = useState<RuntimeValues>(() => initialValues(doc));
  const [draft, setDraft] = useState<RuntimeValues>(() => initialValues(doc));
  const [applied, setApplied] = useState<Record<string, RuntimeValues>>({});
  const [hidden, setHidden] = useState(() => new Set(doc.elements.filter(e => e.hidden).map(e => e.id)));
  const [rowContext, setRowContext] = useState<RowContext>();
  const [mockRows, setMockRows] = useState<Record<string, Record<string, string>[]>>({});
  const dialog = doc.dialogs?.find(item => item.id === modalId);
  function closeDialog() { setModalId(null); setRowContext(undefined); }
  useEffect(() => { if (modalId) form.setFieldsValue(draft); }, [modalId, rowContext]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDialog(); };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  function openDialog(id: string, context?: RowContext) {
    if (!doc.dialogs?.some(item => item.id === id)) { void message.warning('请先在编辑器中配置目标弹窗'); return; }
    form.resetFields();
    setDraft(rowDraft(doc, id, values, context?.row)); setRowContext(context); setModalId(id);
  }
  function rowAction(table: PrototypeElement, action: TableRowAction, rowIndex: number) {
    const row = table.table?.rows[rowIndex]; if (!row) return;
    if (action.action === 'modal' && action.modalId) openDialog(action.modalId, { tableId: table.id, rowIndex, row: { ...row } });
    if (action.action === 'toast') void message.info(rowText(action.message || '操作成功', row));
  }
  function activate(e: PrototypeElement) {
    if (e.action === 'modal') {
      if (e.modalId && doc.dialogs?.some(item => item.id === e.modalId)) {
        openDialog(e.modalId, modalId ? rowContext : undefined);
      } else void message.warning('请先在编辑器中配置目标弹窗');
    }
    if (e.action === 'closeModal') closeDialog();
    if (e.action === 'submit') void form.validateFields().then(() => { closeDialog(); void message.success(rowText(e.actionText || '操作成功', rowContext?.row)); }).catch(() => {});
    if (e.action === 'toast') void message.success(rowText(e.actionText || '操作成功', rowContext?.row));
    if (e.action === 'updateRow' || e.action === 'deleteRow') {
      if (!rowContext || !modalId) { void message.warning('请从表格行操作打开此弹窗，才能修改当前行'); return; }
      const table = doc.elements.find(item => item.id === rowContext.tableId)?.table;
      if (!table) return;
      const save = (fields: RuntimeValues) => {
        try {
          const rows = updateMockRow(mockRows[rowContext.tableId] || table.rows, rowContext, doc.elements, modalId, { ...draft, ...fields }, e.action === 'deleteRow');
          setMockRows(old => ({ ...old, [rowContext.tableId]: rows }));
          closeDialog(); void message.success(rowText(e.actionText || '操作成功', rowContext.row));
        } catch (error) { void message.warning(error instanceof Error ? error.message : '操作失败'); }
      };
      void form.validateFields().then(save).catch(() => {});
    }
    if (e.action === 'toggle' && e.targetId) setHidden(old => { const next = new Set(old); next.has(e.targetId!) ? next.delete(e.targetId!) : next.add(e.targetId!); return next; });
    if (e.action === 'filter' && e.targetId) setApplied(old => ({ ...old, [e.targetId!]: structuredClone(values) }));
    if (e.action === 'reset' && e.targetId) {
      const sources = doc.elements.find(item => item.id === e.targetId)?.table?.filters?.filter(f => doc.elements.find(item => item.id === f.sourceId)?.kind !== 'tabs').map(f => f.sourceId) || [];
      const next = { ...values }; sources.forEach(id => { next[id] = ''; });
      setValues(next); setApplied(old => ({ ...old, [e.targetId!]: structuredClone(next) }));
    }
    if (e.action === 'apply') {
      const invalid = doc.elements.find(item => item.parentId === modalId && item.choices?.requiredAny?.length && !item.choices.requiredAny.some(id => (draft[item.id] || []).includes(id)));
      if (invalid) { void message.warning(`${invalid.name}：请至少勾选一项必选字段`); return; }
      setValues(old => ({ ...old, ...Object.fromEntries(doc.elements.filter(item => item.parentId === modalId).map(item => [item.id, draft[item.id] || ''])) })); closeDialog();
      if (e.actionText) void message.success(e.actionText);
    }
  }
  function change(e: PrototypeElement, value: RuntimeValue) {
    const next = { ...values, [e.id]: value };
    if (e.kind === 'tabs') {
      doc.elements.filter(item => item.table?.filters?.some(f => f.sourceId === e.id)).forEach(item => item.table?.filters?.forEach(filter => { if (filter.sourceId !== e.id) next[filter.sourceId] = ''; }));
      setApplied({});
    }
    setValues(next);
  }
  function node(e: PrototypeElement, inDialog = false) {
    const display = { ...e, text: inDialog ? rowText(e.text, rowContext?.row) : e.text, ...(e.table && mockRows[e.id] ? { table: { ...e.table, rows: mockRows[e.id] } } : {}) };
    return <div key={e.id} data-preview-id={e.id} style={{ ...elementStyle(e), cursor: e.action !== 'none' ? 'pointer' : undefined }} onClick={() => { if (['rectangle', 'ellipse', 'text', 'line', 'vector'].includes(e.kind)) activate(e); }}>
      {inDialog && isFormControl(e) ? <Form.Item name={e.id} rules={[...(e.required ? [{ required: true, message: (e.kind === 'input' ? '请输入' : '请选择') + e.name }] : []), ...(e.inputType === 'email' ? [{ type: 'email' as const, message: '请输入有效邮箱' }] : [])]} style={{ margin: 0, height: '100%' }}><ElementView element={display} preview activate={activate}/></Form.Item> : <ElementView element={display} preview activate={activate} onRowAction={rowAction} value={(inDialog ? draft : values)[e.id]} onChange={value => inDialog ? setDraft(old => ({ ...old, [e.id]: value })) : change(e, value)} values={inDialog ? draft : values} applied={applied[e.id]} notify={text => { void message.info(text); }}/>}
    </div>;
  }
  return <>
    <div className="preview-page" style={{ width: doc.width, height: doc.height, background: doc.background }}>{doc.elements.filter(e => !e.parentId && !hidden.has(e.id) && matches(e.visibleWhen, values)).map(e => node(e))}</div>
    <Modal open={!!dialog} title={rowText(dialog?.title || '', rowContext?.row)} width={(dialog?.width || 472) + 48} footer={null} onCancel={closeDialog} destroyOnHidden styles={{ body: { background: dialog?.background } }}>
      {dialog && <Form key={dialog.id} form={form} initialValues={draft} onValuesChange={changed => setDraft(old => ({ ...old, ...changed }))} preserve={false} component={false}><div className="runtime-dialog-canvas" style={{ width: dialog.width, height: dialog.height, background: dialog.background }}>{doc.elements.filter(e => e.parentId === dialog.id && !hidden.has(e.id) && matches(e.visibleWhen, draft)).map(e => node(e, true))}</div></Form>}
    </Modal>
  </>;
}
