import { makeElement, type PrototypeDocument, type PrototypeElement } from '../../shared/model';
const element = (kind: PrototypeElement['kind'], id: string, props: Partial<PrototypeElement>): PrototypeElement => ({ ...makeElement(kind), id, ...props });
export function rowActionDocument(): PrototypeDocument {
  return {
    width: 1040, height: 720, background: '#ffffff',
    dialogs: [
      { id: 'edit-record', title: '修改 {{row.name}}', width: 480, height: 260, background: '#ffffff' },
      { id: 'delete-record', title: '移除记录', width: 480, height: 180, background: '#ffffff' },
    ],
    elements: [
      element('input', 'row-search', { name: '筛选记录', x: 40, y: 20, text: '筛选记录' }),
      element('table', 'records', { name: '记录表格', x: 40, y: 80, width: 960, height: 270, table: {
        columns: [{ key: 'name', title: '名称' }, { key: 'status', title: '状态' }],
        rows: ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(name => ({ name, status: 'active', secret: name + '-hidden' })), pageSize: 2,
        filters: [{ sourceId: 'row-search', fields: ['name'], mode: 'contains', live: true }],
        rowActions: [
          { id: 'edit', label: '修改资料', action: 'modal', modalId: 'edit-record' },
          { id: 'delete', label: '移除', action: 'modal', modalId: 'delete-record' },
          { id: 'show', label: '说明', action: 'toast', message: '选中了 {{row.name}}' },
        ],
      } }),
      element('table', 'other-records', { name: '另一张表格', x: 40, y: 400, width: 960, height: 230, table: {
        columns: [{ key: 'name', title: '商品' }], rows: [{ name: '商品甲', status: 'active' }], pageSize: 2,
        rowActions: [{ id: 'other-edit', label: '编辑商品', action: 'modal', modalId: 'edit-record' }, { id: 'other-delete', label: '移除商品', action: 'modal', modalId: 'delete-record' }],
      } }),
      element('text', 'row-summary', { name: '行详情', parentId: 'edit-record', x: 0, y: 0, width: 460, height: 30, fontSize: 14, text: '当前记录：{{row.name}}' }),
      element('input', 'row-name', { name: '记录名称', parentId: 'edit-record', x: 0, y: 50, width: 460, rowField: 'name', required: true }),
      element('select', 'row-status', { name: '记录状态', parentId: 'edit-record', x: 0, y: 105, width: 460, rowField: 'status', select: { options: [{ id: 'active', label: '启用' }, { id: 'archived', label: '归档' }], defaultValues: [], multiple: false, allowClear: true, disabled: false } }),
      element('button', 'edit-cancel', { parentId: 'edit-record', x: 260, y: 205, width: 90, text: '取消修改', action: 'closeModal' }),
      element('button', 'edit-save', { parentId: 'edit-record', x: 370, y: 205, width: 90, text: '保存修改', action: 'updateRow', actionText: '模拟记录已更新' }),
      element('text', 'delete-summary', { parentId: 'delete-record', x: 0, y: 0, width: 460, height: 60, fontSize: 14, text: '是否移除 {{row.name}}？' }),
      element('button', 'delete-cancel', { parentId: 'delete-record', x: 260, y: 110, width: 90, text: '取消移除', action: 'closeModal' }),
      element('button', 'delete-confirm', { parentId: 'delete-record', x: 370, y: 110, width: 90, text: '确认移除', action: 'deleteRow', actionText: '模拟记录已移除' }),
    ],
  };
}
