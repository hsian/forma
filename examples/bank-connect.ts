import { makeElement, type ElementKind, type PrototypeDocument, type PrototypeElement } from '../shared/model';

// 交易页根据 finance-admin/bookkeeping/cashierBookkeeping/bankStatementDetails.vue
// 及 useBankStatementDetails.js 整理；查询页未找到同名源码，按同一交易字段制作。
// 以下组织、账号、流水及金额均为虚构的原型数据。
export function bankConnectDocument(convert: boolean): PrototypeDocument {
  const elements: PrototypeElement[] = [];
  const add = (kind: ElementKind, id: string, text: string, x: number, y: number, width: number, height: number, extra: Partial<PrototypeElement> = {}) => {
    const e = { ...makeElement(kind, x, y), id, name: text, text, width, height, ...extra }; elements.push(e); return e;
  };
  const title = convert ? '交易明细转出纳账' : '账户流水明细查询';
  add('rectangle', 'bg', '内容背景', 16, 16, 1408, 810, { fill: '#ffffff', strokeWidth: 0 });
  add('text', 'heading', title, 40, 34, 900, 36, { fontSize: 22 });
  add('text', 'intro', convert ? '系统自动过滤已生成出纳记账（流水）的银行交易明细' : '查询银行账户的交易明细、资金方向及余额', 40, 78, 1200, 24, { fontSize: 13, color: '#8990a1' });
  const select = (id: string, label: string, x: number, options: string[], y = 118) => {
    add('text', id + '-label', label, x, y + 6, 100, 24, { fontSize: 14 });
    add('select', id, '全部' + label, x + 80, y, 250, 36, { select: { options: options.map(value => ({ id: value, label: value })), defaultValues: [], multiple: false, disabled: false, allowClear: true } });
  };
  select('bank', '开户机构', 40, ['示范农商银行青禾支行', '示范农业银行云溪支行']);
  select('account', '银行账号', 410, ['DEMO-6228-0001', 'DEMO-6228-0002']);
  add('text', 'date-label', '交易日期', 780, 124, 80, 24, { fontSize: 14 });
  add('rangePicker', 'dates', '交易日期范围', 860, 118, 330, 36);
  add('input', 'keyword', '交易流水号、对方户名、摘要关键词', 40, 176, 520, 36);
  const button = (id: string, text: string, x: number, y: number, width: number, extra: Partial<PrototypeElement> = {}) => add('button', id, text, x, y, width, 36, { fill: '#1677ff', ...extra });
  button('query', '查询', 580, 176, 80, { action: 'filter', targetId: 'transactions' });
  button('reset', '重置', 672, 176, 80, { action: 'reset', targetId: 'transactions', fill: '#ffffff', color: '#60667b' });
  const rows = Array.from({ length: 12 }, (_, i) => ({ tradeTime: `2026-10-${String(22 - i).padStart(2, '0')} 10:20:00`, openBankName: i % 2 ? '示范农业银行云溪支行' : '示范农商银行青禾支行', bankAccountNo: `DEMO-6228-000${i % 2 + 1}`, bankTradeNo: `DEMO-TXN-${String(i + 1).padStart(6, '0')}`, typeText: i % 3 ? '收入' : '支出', amount: i % 3 ? '2,800.00' : '1,200.00', balance: '128,600.00', targetAccountNo: 'DEMO-COUNTERPART-001', targetAccountName: ['示范农业服务公司', '示范村集体经济合作社', '示范工程服务公司'][i % 3], targetAccountBranchCode: 'DEMO-001', targetAccountBranchName: '示范银行营业部', postscript: '模拟交易', summary: ['服务费收入', '经营收入', '工程款支出'][i % 3], purpose: '原型演示', remark: '虚构数据', ereceiptId: `DEMO-RECEIPT-${i + 1}`, deletionReason: '重复交易记录（示例）', gmtModified: '2026-10-23 09:00:00' }));
  const columns = [['tradeTime', '交易时间', 180], ['openBankName', '开户机构', 240], ['bankAccountNo', '银行账号', 190], ['bankTradeNo', '银行交易流水号', 190], ['typeText', '资金方向', 100], ['amount', '发生额（元）', 140], ['balance', '账户余额（元）', 150], ['targetAccountNo', '对方账号', 210], ['targetAccountName', '对方户名', 220], ['targetAccountBranchCode', '对方开户机构联行号', 180], ['targetAccountBranchName', '对方开户机构', 220], ['postscript', '附言', 150], ['summary', '摘要', 200], ['purpose', '用途', 180], ['remark', '备注', 180], ['ereceiptId', '电子回单唯一标识', 220]].map(([key, title, width]) => ({ key: String(key), title: String(title), width: Number(width) }));
  const dialogs: NonNullable<PrototypeDocument['dialogs']> = [];
  const dialog = (id: string, title: string, action: 'submit' | 'deleteRow', message: string) => {
    dialogs.push({ id, title, width: 640, height: 300, background: '#ffffff' });
    add('text', id + '-text', message, 16, 16, 608, 90, { parentId: id, fontSize: 14 });
    if (id === 'delete') add('textArea', 'delete-reason', '删除说明', 16, 118, 608, 90, { parentId: id, required: true, text: '请输入删除原因（必填）' });
    button(id + '-cancel', '取消', 428, 248, 88, { parentId: id, action: 'closeModal', fill: '#ffffff', color: '#60667b' });
    button(id + '-ok', '确定', 528, 248, 88, { parentId: id, action, actionText: id === 'delete' ? '已从本次预览移除此行（模拟）' : '操作完成（原型演示）' });
  };
  dialog('detail', '交易明细', 'submit', '交易时间：{{row.tradeTime}}\n银行账号：{{row.bankAccountNo}}\n对方户名：{{row.targetAccountName}}\n发生额：{{row.amount}} 元　摘要：{{row.summary}}');
  if (convert) {
    add('tabs', 'mode', '交易状态', 40, 236, 650, 48, { choices: { options: [{ id: 'normal', label: '未生成出纳流水动账明细' }, { id: 'recycle', label: '回收站' }], defaultValues: ['normal'] } });
    dialog('generate', '生成出纳流水', 'submit', '确认将此交易生成出纳流水？\n交易时间：{{row.tradeTime}}\n对方户名：{{row.targetAccountName}}\n金额：{{row.amount}} 元\n本次仅演示确认，不写入真实业务账。');
    dialog('delete', '删除银行动账明细', 'deleteRow', '确认删除交易 {{row.bankTradeNo}}？\n删除说明为必填。本次仅从预览移除此行，刷新后恢复。');
    button('batch-generate', '生成出纳流水', 710, 240, 150, { action: 'toast', actionText: '批量生成仅展示入口，请使用表格行操作体验单笔确认。', visibleWhen: { sourceId: 'mode', value: 'normal' } });
    button('batch-delete', '删除', 872, 240, 80, { action: 'toast', actionText: '请使用表格行操作体验删除说明与确认。', visibleWhen: { sourceId: 'mode', value: 'normal' } });
  } else select('direction', '资金方向', 780, ['收入', '支出'], 176);
  button('export', '导出', 1280, 240, 100, { action: 'toast', actionText: '导出入口演示，未生成真实文件。' });
  const filters = [{ sourceId: 'bank', fields: ['openBankName'], mode: 'equals' as const, live: false }, { sourceId: 'account', fields: ['bankAccountNo'], mode: 'equals' as const, live: false }, { sourceId: 'keyword', fields: ['bankTradeNo', 'targetAccountName', 'summary'], mode: 'contains' as const, live: false }];
  if (!convert) filters.push({ sourceId: 'direction', fields: ['typeText'], mode: 'equals', live: false });
  add('table', 'transactions', '银行交易明细表格', 40, 300, 1340, 460, { table: { columns, rows, pageSize: 6, filters, rowActions: convert ? [{ id: 'generate', label: '生成出纳流水', action: 'modal', modalId: 'generate' }, { id: 'delete', label: '删除', action: 'modal', modalId: 'delete' }] : [{ id: 'detail', label: '详情', action: 'modal', modalId: 'detail' }], rowMessage: '已选择 {{row.bankTradeNo}}' }, ...(convert ? { visibleWhen: { sourceId: 'mode', value: 'normal' } } : {}) });
  if (convert) add('table', 'recycled', '回收站明细', 40, 300, 1340, 460, { visibleWhen: { sourceId: 'mode', value: 'recycle' }, table: { columns: [...columns, { key: 'deletionReason', title: '删除说明', width: 220 }, { key: 'gmtModified', title: '删除时间', width: 180 }], rows: rows.slice(0, 2), pageSize: 6, rowActions: [{ id: 'recover', label: '恢复', action: 'toast', message: '恢复 {{row.bankTradeNo}}（入口演示，未移动模拟记录）' }] } });
  add('text', 'note', '全部为虚构模拟数据。日期范围仅演示选择；开户机构、账号和关键词支持查询，表格可横向滚动查看全部字段。', 40, 784, 1340, 26, { fontSize: 12, color: '#9298a9' });
  return { width: 1440, height: 850, background: '#f5f7fa', elements, dialogs };
}
