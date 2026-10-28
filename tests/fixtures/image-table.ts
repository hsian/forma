import { makeElement, type PrototypeDocument } from '../../shared/model';

export function imageTableDocument(appearance = false): PrototypeDocument {
  const table = { ...makeElement('table'), id: 'image-bank-table', x: 10, y: 99, width: 1265, height: 165, fontSize: 14, fill: '#ffffff', color: '#002451', radius: 0,
    table: { pageSize: 5, columns: [
      { key: 'select', title: '☐', width: 50 }, { key: 'index', title: '序号', width: 82 },
      { key: 'bank', title: '开户银行', width: 307 }, { key: 'account', title: '银行账号', width: 225 },
      { key: 'connected', title: '是否对接银农直连', width: 195 }, { key: 'date', title: '申请签约时间', width: 184 },
      { key: 'status', title: '是否…', width: 58 }, { key: 'operation', title: '操作', width: 164 },
    ], rows: Array.from({ length: 4 }, (_, i) => ({ select: '☐', index: String(i + 1), bank: '示例银行股份有限公司', account: `60000000000000000${i}`, connected: i < 3 ? '是' : '否', date: '2026-10-12', status: '', operation: i ? '暂无操作' : '编辑开通信息' })),
    ...(appearance ? { pagination: false, appearance: { rowHeight: 33, headerHeight: 32, headerBackground: '#e3efff', headerColor: '#002451', bodyBackground: '#ffffff', bodyColor: '#002451', borderColor: '#d8d8d8', bordered: true, align: 'center' as const } } : {}),
  } };
  return { width: 1289, height: 289, background: '#ffffff', elements: [
    { ...makeElement('button'), id: 'work-tab', text: '工作台 ×', x: 0, y: 0, width: 88, height: 35, fill: '#f7f8fa', color: '#63758a', component: { type: 'text' } },
    { ...makeElement('text'), id: 'bank-summary', text: '银行账户共 4 个，开通 1 个，未开通 3 个。', x: 10, y: 54, width: 500, height: 24, fontSize: 14 },
    table,
  ] };
}
