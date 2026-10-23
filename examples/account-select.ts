import { makeElement, type ElementKind, type PrototypeDocument, type PrototypeElement } from '../shared/model';

// 根据 finance-admin/accountManage/accountSelect 的结构整理。全部记录均为虚构模拟数据。
export function accountSelectDocument(): PrototypeDocument {
  const element = (kind: ElementKind, id: string, name: string, x: number, y: number, width: number, height: number, extra: Partial<PrototypeElement> = {}): PrototypeElement => ({ ...makeElement(kind, x, y), id, name, width, height, ...extra });
  const normal = { sourceId: 'account-tabs', value: 'normal' };
  const disabled = { sourceId: 'account-tabs', value: 'disabled' };
  const fields = [
    { id: 'accountBookName', label: '账套名称' }, { id: 'creditCode', label: '统一社会信用代码' },
    { id: 'accountBookOrganizationName', label: '所属组织机构' }, { id: 'organizationLevel', label: '组织级别' },
    { id: 'organizationsName', label: '记账服务机构' },
  ];
  const disabledFields = [...fields, { id: 'accountBookStatusName', label: '账套状态' }];
  const requiredAny = fields.slice(0, 3).map(f => f.id);
  const dialogId = 'account-view-dialog';
  const rows = Array.from({ length: 16 }, (_, index) => {
    const stopped = index >= 9;
    const orgIndex = index % 3;
    const org = ['青禾村', '云溪村', '新桥组'][orgIndex];
    return { accountBookName: `${org}${2026 - index % 2}年度账套${index > 5 ? '（示例）' : ''}`, creditCode: `DEMO${String(index + 1).padStart(14, '0')}`, accountBookOrganizationName: `示范镇 / ${org}`, organizationLevel: orgIndex === 2 ? '组级' : '村级', organizationsName: '示范财务服务中心', accountBookStatusName: stopped ? index % 2 ? '已停用' : '已注销' : '正常使用', state: stopped ? 'disabled' : 'normal', status: index % 2 ? 'stopped' : 'cancelled', level: orgIndex === 2 ? '06' : '05', org: ['village-a', 'village-b', 'group-a'][orgIndex], scope: 'all' };
  });
  return { width: 1280, height: 760, background: '#f5f7fa', dialogs: [{ id: dialogId, title: '自定义视图', width: 740, height: 430, background: '#ffffff' }], elements: [
    element('rectangle', 'account-header-bg', '页签栏背景', 16, 16, 1248, 56, { fill: '#ffffff', radius: 8, strokeWidth: 0 }),
    element('tabs', 'account-tabs', '账套状态页签', 32, 19, 750, 48, { choices: { options: [{ id: 'normal', label: '正常使用账套' }, { id: 'disabled', label: '停用注销账套' }], defaultValues: ['normal'] } }),
    element('button', 'account-custom-view', '自定义视图按钮', 1110, 28, 136, 32, { text: '☷ 自定义视图', fill: '#ffffff', color: '#1677ff', stroke: '#d9e4f5', action: 'modal', modalId: dialogId, actionText: '自定义视图' }),
    element('rectangle', 'account-tree-bg', '组织机构区域背景', 16, 88, 224, 626, { fill: '#ffffff', strokeWidth: 0, radius: 8 }),
    element('text', 'account-tree-title', '组织机构标题', 32, 108, 180, 28, { text: '组织机构', fontSize: 16 }),
    element('tree', 'account-tree', '组织机构', 32, 148, 192, 542, { choices: { options: [{ id: 'all', label: '示范镇' }, { id: 'village-a', label: '青禾村', parentId: 'all' }, { id: 'village-b', label: '云溪村', parentId: 'all' }, { id: 'group-a', label: '新桥组', parentId: 'all' }], defaultValues: ['all'] } }),
    element('rectangle', 'account-list-bg', '账套列表背景', 256, 88, 1008, 626, { fill: '#ffffff', strokeWidth: 0, radius: 8 }),
    element('text', 'account-list-title', '账套列表标题', 276, 108, 700, 30, { text: '账套列表', fontSize: 18 }),
    element('input', 'account-keyword', '账套关键词', 276, 156, 448, 36, { text: '账套名称、组织机构、信用代码、服务机构关键字' }),
    element('select', 'account-level', '组织级别筛选', 740, 156, 150, 36, { text: '全部组织级别', select: { options: [{ id: '06', label: '组级' }, { id: '05', label: '村级' }, { id: '07', label: '乡镇级' }], defaultValues: [], multiple: false, allowClear: true, disabled: false } }),
    element('button', 'account-query', '查询按钮', 1080, 156, 76, 36, { text: '查询', fill: '#1677ff', action: 'filter', targetId: 'account-table' }),
    element('button', 'account-reset', '重置按钮', 1168, 156, 76, 36, { text: '重置', fill: '#ffffff', color: '#60667b', action: 'reset', targetId: 'account-table' }),
    element('select', 'account-status', '停用注销状态筛选', 906, 156, 158, 36, { text: '全部账套状态', visibleWhen: disabled, select: { options: [{ id: 'stopped', label: '已停用' }, { id: 'cancelled', label: '已注销' }], defaultValues: [], multiple: false, allowClear: true, disabled: false } }),
    element('text', 'account-hint', '列表操作提示', 276, 208, 920, 24, { text: '选择左侧组织机构查看账套，或输入关键词查询。', fontSize: 12, color: '#8b93a5' }),
    element('table', 'account-table', '账套列表', 276, 246, 968, 440, { table: {
      columns: disabledFields.map((field, index) => ({ key: field.id, title: field.label, width: [220, 220, 220, 110, 180, 110][index], ...(field.id === 'accountBookStatusName' ? { visibleWhen: disabled } : {}) })),
      rows, pageSize: 5, rowActionText: '进入', rowMessage: '已选择账套。真实系统根据权限进入菜单，此原型暂不连接业务系统。',
      filters: [
        { sourceId: 'account-tabs', fields: ['state'], mode: 'equals', live: true },
        { sourceId: 'account-tree', fields: ['org', 'scope'], mode: 'equals', live: true },
        { sourceId: 'account-keyword', fields: ['accountBookName', 'creditCode', 'accountBookOrganizationName', 'organizationsName'], mode: 'contains', live: false },
        { sourceId: 'account-level', fields: ['level'], mode: 'equals', live: true },
        { sourceId: 'account-status', fields: ['status'], mode: 'equals', live: true, when: disabled },
      ],
      columnControls: [{ sourceId: 'account-normal-fields', when: normal }, { sourceId: 'account-disabled-fields', when: disabled }],
    } }),
    element('text', 'account-footnote', '模拟数据说明', 24, 730, 1220, 24, { text: '账套选择 · 所有账套及组织均为模拟数据，可在编辑器中修改组件、数据及交互。', fontSize: 12, color: '#9299a9' }),
    element('text', 'account-dialog-help', '自定义视图说明', 0, 0, 740, 28, { parentId: dialogId, text: '列表字段，可勾选配置展示项。取消会放弃本次修改，确定后应用到表格。', fontSize: 14, color: '#7c8496' }),
    element('text', 'account-normal-title', '正常使用账套分组标题', 0, 48, 740, 28, { parentId: dialogId, text: '1. 正常使用账套', fontSize: 16 }),
    element('checkbox', 'account-normal-fields', '正常使用账套展示字段', 0, 88, 740, 92, { parentId: dialogId, choices: { options: fields, defaultValues: fields.map(f => f.id), requiredAny } }),
    element('text', 'account-disabled-title', '停用注销账套分组标题', 0, 196, 740, 28, { parentId: dialogId, text: '2. 停用注销账套', fontSize: 16 }),
    element('checkbox', 'account-disabled-fields', '停用注销账套展示字段', 0, 236, 740, 92, { parentId: dialogId, choices: { options: disabledFields, defaultValues: disabledFields.map(f => f.id), requiredAny } }),
    element('text', 'account-required-note', '字段校验说明', 0, 344, 740, 24, { parentId: dialogId, text: '每组的账套名称、统一社会信用代码、所属组织机构，至少勾选一项。', fontSize: 12, color: '#9299a9' }),
    element('button', 'account-view-cancel', '取消自定义视图', 552, 390, 84, 36, { parentId: dialogId, text: '取消', fill: '#ffffff', color: '#60667b', action: 'closeModal' }),
    element('button', 'account-view-confirm', '应用自定义视图', 652, 390, 88, 36, { parentId: dialogId, text: '确定', fill: '#1677ff', action: 'apply', actionText: '视图定义成功' }),
  ] };
}
