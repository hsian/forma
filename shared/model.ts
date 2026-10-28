import { randomId } from './uuid.js';
import type { DrawingStyle, SketchImportReport } from './drawing';
import { antdCatalog, antdKinds, componentDefaults, getComponentDefinition, type AntdKind, type ComponentConfig } from './antd-catalog';
export const basicKinds = ['rectangle', 'ellipse', 'text', 'line', 'vector'] as const;
export type ElementKind = typeof basicKinds[number] | AntdKind;
export const elementKinds: ElementKind[] = [...basicKinds, ...antdKinds];
export type Action = 'none' | 'modal' | 'toast' | 'toggle' | 'closeModal' | 'submit' | 'filter' | 'reset' | 'apply' | 'updateRow' | 'deleteRow';
export interface TableRowAction { id: string; label: string; action: 'modal' | 'toast'; modalId?: string; message?: string }
export interface Condition { sourceId: string; value: string }
export interface ChoiceConfig { options: (SelectOption & { parentId?: string })[]; defaultValues: string[]; requiredAny?: string[] }
export interface TableConfig {
  columns: { key: string; title: string; width?: number; align?: 'left' | 'center' | 'right'; fixed?: 'left' | 'right'; visibleWhen?: Condition }[];
  rows: Record<string, string>[]; pageSize: number;
  pagination?: boolean;
  scrollWidth?: number;
  appearance?: { rowHeight?: number; headerHeight?: number; headerBackground?: string; headerColor?: string; bodyBackground?: string; bodyColor?: string; borderColor?: string; bordered?: boolean; align?: 'left' | 'center' | 'right' };
  filters?: { sourceId: string; fields: string[]; mode: 'contains' | 'equals'; live: boolean; when?: Condition }[];
  columnControls?: { sourceId: string; when?: Condition }[];
  rowActionText?: string; rowMessage?: string;
  rowActions?: TableRowAction[];
}
export interface SelectOption { id: string; label: string }
export interface SelectConfig {
  options: SelectOption[]; defaultValues: string[];
  multiple: boolean; allowClear: boolean; disabled: boolean;
}
export interface PrototypeElement {
  id: string; kind: ElementKind; name: string;
  x: number; y: number; width: number; height: number; rotation: number;
  text: string; fill: string; color: string; stroke: string; strokeWidth: number;
  radius: number; fontSize: number; opacity: number; hidden: boolean; locked: boolean;
  action: Action; targetId?: string; actionText: string; modalId?: string;
  parentId?: string; required?: boolean; inputType?: 'text' | 'email';
  select?: SelectConfig;
  choices?: ChoiceConfig; table?: TableConfig; visibleWhen?: Condition;
  rowField?: string;
  component?: ComponentConfig;
  clipPaths?: string[]; clipRules?: ('evenodd'|'nonzero')[];
  drawing?: DrawingStyle;
  vector?: { path: string; viewWidth: number; viewHeight: number; fillEnabled: boolean; fillOpacity: number; strokeOpacity: number; fillRule: 'evenodd' | 'nonzero'; rectangleRadii?: [number,number,number,number] };
  typography?: { fontFamily: string; fontWeight: number; align: 'left' | 'center' | 'right'; lineHeight: number; sourceFont?: string; fontStyle?: 'normal' | 'italic'; letterSpacing?: number; wrap?: 'nowrap' | 'wrap'; verticalAlign?: 'top' | 'middle' | 'bottom'; originalText?:string; baseColor?:string; runs?: {start:number;length:number;fontFamily:string;fontWeight:number;fontStyle:'normal'|'italic';fontScale:number;letterSpacing:number;color:string;opacity:number}[] };
  importTransform?: [number, number, number, number];
  source?: { layerId: string; groups: { id: string; name: string }[] };
}
export interface PrototypeDialog { id: string; title: string; width: number; height: number; background: string }
/** Coordinates are relative to the page or dialog, so pins follow canvas resizing. */
export interface PrototypeAnnotation { id: string; number: number; x: number; y: number; title: string; content: string; dialogId?: string }
export interface PrototypeDocument { importInfo?: { report: SketchImportReport; sourceHash?:string; sourcePageId?:string; sourceBoardId?:string; importedAt?:number; importedBy?:string; acknowledgedDifferences?:boolean }; width: number; height: number; background: string; elements: PrototypeElement[]; dialogs?: PrototypeDialog[]; annotations?: PrototypeAnnotation[] }
export const kindNames = { rectangle: '矩形', ellipse: '椭圆', text: '文本', line: '直线', vector: '矢量图形', ...Object.fromEntries(antdKinds.map(kind => [kind, antdCatalog[kind].label])) } as Record<ElementKind, string>;
export function makeSelectConfig(labels = ['选项一', '选项二']): SelectConfig {
  return { options: labels.map(label => ({ id: randomId(), label })), defaultValues: [], multiple: false, allowClear: true, disabled: false };
}
export function normalizeSelectConfig(config: SelectConfig): SelectConfig {
  const valid = new Set(config.options.map(option => option.id));
  const defaults = [...new Set(config.defaultValues)].filter(id => valid.has(id));
  return { ...config, defaultValues: config.multiple ? defaults : defaults.slice(0, 1) };
}
export function getSelectConfig(element: PrototypeElement): SelectConfig {
  return normalizeSelectConfig(element.select ?? { options: [{ id: 'option-1', label: '选项一' }, { id: 'option-2', label: '选项二' }], defaultValues: [], multiple: false, allowClear: true, disabled: false });
}
export function makeElement(kind: ElementKind, x = 80, y = 80): PrototypeElement {
  const basics: Record<typeof basicKinds[number], [number, number]> = { rectangle: [200, 140], ellipse: [140, 140], text: [220, 40], line: [240, 8], vector: [100, 100] };
  const dimensions = getComponentDefinition(kind)?.size || basics[kind as typeof basicKinds[number]];
  const component = componentDefaults(kind);
  return { id: randomId(), kind, name: kindNames[kind], x, y, width: dimensions[0], height: dimensions[1], rotation: 0, text: kind === 'text' ? '双击编辑文字' : ['input', 'textArea', 'inputSearch', 'inputPassword', 'autoComplete', 'mentions'].includes(kind) ? '请输入内容' : kind === 'select' ? '请选择' : kindNames[kind], fill: kind === 'button' ? '#635bff' : kind === 'rectangle' || kind === 'ellipse' ? '#eeedff' : '#ffffff', color: kind === 'button' ? '#ffffff' : '#303447', stroke: '#dcdfe8', strokeWidth: kind === 'text' ? 0 : 1, radius: 6, fontSize: kind === 'text' ? 20 : 14, opacity: 1, hidden: false, locked: false, action: 'none', actionText: '操作成功', ...(Object.keys(component).length ? { component } : {}), ...(kind === 'vector' ? { vector: { path: 'M0 100 L50 0 L100 100 Z', viewWidth: 100, viewHeight: 100, fillEnabled: true, fillOpacity: 1, strokeOpacity: 1, fillRule: 'nonzero' as const } } : {}), ...(kind === 'select' ? { select: makeSelectConfig() } : {}), ...(['tabs', 'tree', 'checkbox'].includes(kind) ? { choices: { options: [{ id: 'one', label: '选项一' }, { id: 'two', label: '选项二' }], defaultValues: kind === 'checkbox' ? [] : ['one'] } } : {}) };
}
const el = (kind: ElementKind, props: Partial<PrototypeElement>) => ({ ...makeElement(kind), ...props });
export function makeDialog(title = '新建弹窗', sample = false): { dialog: PrototypeDialog; elements: PrototypeElement[] } {
  const dialog: PrototypeDialog = { id: randomId(), title, width: 472, height: 400, background: '#ffffff' };
  const elements = sample ? [
    el('text', { name: '姓名标签', text: '成员姓名 *', x: 0, y: 0, width: 450, height: 24, fontSize: 14 }),
    el('input', { name: '成员姓名', text: '请输入成员姓名', x: 0, y: 30, width: 472, required: true }),
    el('text', { name: '邮箱标签', text: '邮箱 *', x: 0, y: 100, width: 450, height: 24, fontSize: 14 }),
    el('input', { name: '邮箱', text: 'name@example.com', x: 0, y: 130, width: 472, required: true, inputType: 'email' }),
    el('text', { name: '角色标签', text: '角色', x: 0, y: 200, width: 450, height: 24, fontSize: 14 }),
    el('select', { name: '角色', text: '请选择角色', x: 0, y: 230, width: 472, select: makeSelectConfig(['管理员', '编辑者', '访客']) }),
  ] : [];
  elements.push(
    el('button', { name: '取消按钮', text: '取消', x: 288, y: 354, width: 80, fill: '#ffffff', color: '#60667b', action: 'closeModal' }),
    el('button', { name: '确定按钮', text: '确定', x: 384, y: 354, width: 88, action: 'submit', actionText: '提交成功（原型演示，未写入表格）' }),
  );
  return { dialog, elements: elements.map(e => ({ ...e, parentId: dialog.id })) };
}
const memberDialog = makeDialog('新增成员', true);
export const seedDocument: PrototypeDocument = {
  width: 1040, height: 720, background: '#f7f8fb', dialogs: [memberDialog.dialog], elements: [
    el('rectangle', { id: 'header-bg', name: '页头背景', x: 0, y: 0, width: 1040, height: 100, fill: '#ffffff', strokeWidth: 0, radius: 0, locked: true }),
    el('text', { id: 'title', name: '页面标题', x: 40, y: 28, width: 350, height: 35, text: '用户管理', fontSize: 25 }),
    el('text', { id: 'subtitle', name: '页面说明', x: 40, y: 66, width: 600, height: 24, text: '管理团队成员，连接每一份协作。', fontSize: 13, color: '#9296a5' }),
    el('rectangle', { id: 'content-bg', name: '内容背景', x: 32, y: 128, width: 976, height: 525, fill: '#ffffff', stroke: '#e9eaf0', radius: 10 }),
    el('text', { id: 'list-title', name: '列表标题', x: 56, y: 150, width: 250, height: 32, text: '团队成员', fontSize: 17 }),
    el('input', { id: 'search', name: '姓名搜索', x: 56, y: 206, width: 270, text: '搜索成员姓名或邮箱' }),
    el('select', { id: 'status', name: '状态筛选', x: 342, y: 206, width: 180, text: '全部状态', select: makeSelectConfig(['正常', '停用']) }),
    el('button', { id: 'query', name: '查询按钮', x: 538, y: 206, width: 86, text: '查询', action: 'toast', actionText: '查询完成（原型演示）' }),
    el('button', { id: 'add', name: '新增成员按钮', x: 836, y: 148, width: 148, text: '+ 新增成员', action: 'modal', actionText: '新增成员', modalId: memberDialog.dialog.id }),
    el('table', { id: 'users', name: '成员表格', x: 56, y: 266, width: 928, height: 326 }),
    el('text', { id: 'footer', name: '页脚说明', x: 40, y: 677, width: 800, height: 24, text: '这是一个可以自由编辑的示例。试着选中元素，或从左侧拖入新组件。', fontSize: 12, color: '#a0a4b3' }),
    ...memberDialog.elements,
  ],
};
