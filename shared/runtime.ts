import { getSelectConfig, type Condition, type PrototypeDocument, type PrototypeElement } from './model';

export type RuntimeValue = string | string[];
export type RuntimeValues = Record<string, RuntimeValue>;
export function initialValues(doc: PrototypeDocument): RuntimeValues {
  return Object.fromEntries(doc.elements.map(e => [e.id, e.kind === 'select' ? (getSelectConfig(e).multiple ? getSelectConfig(e).defaultValues : getSelectConfig(e).defaultValues[0] || '') : e.choices ? (e.kind === 'checkbox' ? [...e.choices.defaultValues] : e.choices.defaultValues[0] || '') : '']));
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
