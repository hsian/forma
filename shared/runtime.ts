import { getSelectConfig, type Condition, type PrototypeDocument, type PrototypeElement, type TableConfig, type TableRowAction } from './model';
import { componentConfig } from './antd-catalog';

export interface RowContext { tableId: string; rowIndex: number; row: Record<string, string> }
export function rowText(text: string, row?: Record<string, string>) {
  // A field lookup, never an expression evaluator. React renders the returned string as text.
  return text.replace(/\{\{\s*row\.([^{}]+?)\s*\}\}/g, (template, field: string) => row ? (Object.hasOwn(row, field.trim()) ? row[field.trim()] : '') : template);
}
export function rowActions(table: TableConfig): TableRowAction[] {
  return table.rowActions ?? (table.rowActionText ? [{ id: 'legacy-row-action', label: table.rowActionText, action: 'toast', message: table.rowMessage || '已选择此行' }] : []);
}
export function rowDraft(doc: PrototypeDocument, dialogId: string, values: RuntimeValues, row?: Record<string, string>): RuntimeValues {
  const next = { ...values };
  for (const e of doc.elements.filter(e => e.parentId === dialogId && e.rowField)) {
    const value = row?.[e.rowField!] || '';
    next[e.id] = Array.isArray(initialComponentValue(e)) || e.kind === 'select' && getSelectConfig(e).multiple ? (value ? value.split(',') : []) : value;
  }
  return next;
}
export function updateMockRow(rows: Record<string, string>[], context: RowContext, elements: PrototypeElement[], dialogId: string, values: RuntimeValues, remove = false) {
  if (!rows[context.rowIndex]) throw Error('当前行不存在，请重新打开弹窗');
  if (remove) return rows.filter((_, index) => index !== context.rowIndex);
  const patch = Object.fromEntries(elements.filter(e => e.parentId === dialogId && e.rowField && isFormControl(e)).map(e => { const value = values[e.id]; return [e.rowField!, Array.isArray(value) ? value.join(',') : value || '']; }));
  return rows.map((row, index) => index === context.rowIndex ? { ...row, ...patch } : row);
}

export type RuntimeValue = string | string[];
export type RuntimeValues = Record<string, RuntimeValue>;
const formControlKinds = ['input', 'select', 'switch', 'checkboxSingle', 'textArea', 'inputSearch', 'inputPassword', 'inputOtp', 'inputNumber', 'autoComplete', 'cascader', 'colorPicker', 'datePicker', 'rangePicker', 'mentions', 'radio', 'rate', 'slider', 'timePicker', 'timeRangePicker', 'treeSelect'];
export const isFormControl = (element: PrototypeElement) => formControlKinds.includes(element.kind);
export function initialComponentValue(e: PrototypeElement): RuntimeValue {
  const config = componentConfig(e.kind, e.component);
  if (e.kind === 'switch' || e.kind === 'checkboxSingle') return String(config.checked === true);
  if (e.kind === 'rangePicker' || e.kind === 'timeRangePicker') return [String(config.start || ''), String(config.end || '')];
  if (e.kind === 'transfer' || (e.kind === 'cascader' || e.kind === 'treeSelect') && config.multiple) return [];
  return typeof config.value === 'string' || typeof config.value === 'number' ? String(config.value) : '';
}
export function initialValues(doc: PrototypeDocument): RuntimeValues {
  return Object.fromEntries(doc.elements.map(e => [e.id, e.kind === 'select' ? (getSelectConfig(e).multiple ? getSelectConfig(e).defaultValues : getSelectConfig(e).defaultValues[0] || '') : e.choices ? (e.kind === 'checkbox' ? [...e.choices.defaultValues] : e.choices.defaultValues[0] || '') : initialComponentValue(e)]));
}
export function matches(condition: Condition | undefined, values: RuntimeValues) {
  return !condition || values[condition.sourceId] === condition.value;
}
export function tableRows(e: PrototypeElement, values: RuntimeValues, applied: RuntimeValues = {}) {
  return (e.table?.rows || []).filter(row => (e.table?.filters || []).every(filter => {
    if (!matches(filter.when, values)) return true;
    const value = (filter.live ? values : applied)[filter.sourceId];
    if (!value || Array.isArray(value) && !value.length) return true;
    const candidates = Array.isArray(value) ? value : [value];
    return filter.fields.some(field => candidates.some(candidate => filter.mode === 'equals' ? row[field] === candidate : (row[field] || '').toLowerCase().includes(candidate.toLowerCase())));
  }));
}
export function tableColumns(e: PrototypeElement, values: RuntimeValues) {
  const source = e.table?.columnControls?.find(control => matches(control.when, values));
  const selected = source ? values[source.sourceId] : undefined;
  return (e.table?.columns || []).filter(column => matches(column.visibleWhen, values) && (!Array.isArray(selected) || selected.includes(column.key)));
}
