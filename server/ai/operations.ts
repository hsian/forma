import { z } from 'zod';
import { makeElement, type ElementKind, type PrototypeDocument } from '../../shared/model.js';
import { canonicalDocument, type AiResult } from '../../shared/ai.js';
import { documentSchema, elementSchema } from '../document-validation.js';

export const resultSchema = z.object({ reply: z.string().min(1).max(20000), operations: z.array(z.object({
  type: z.enum(['addElement', 'updateElement', 'removeElement', 'upsertDialog', 'updatePage']),
  targetId: z.string().max(200), kind: z.string().max(50), properties: z.string().max(1000000),
}).strict()).max(300) }).strict();
const tablePatch = elementSchema.shape.table.unwrap().partial().strict();
const elementPatch = elementSchema.omit({ id: true, kind: true }).partial().extend({ table: tablePatch.optional() }).strict();
const dialogPatch = z.object({ title: z.string().max(2000), width: z.number().min(1).max(20000), height: z.number().min(1).max(20000), background: z.string().regex(/^#[0-9a-f]{6}$/i) }).partial().strict();
const pagePatch = dialogPatch.omit({ title: true }).strict();
// Give the model the same property definitions that the validator actually accepts.
export const aiPropertySchemas = { element: z.toJSONSchema(elementPatch), dialog: z.toJSONSchema(dialogPatch), page: z.toJSONSchema(pagePatch) };
function parseProperties<T>(schema: z.ZodType<T>, value: unknown, index: number): T {
  try { return schema.parse(value); }
  catch (error) {
    if (error instanceof z.ZodError) throw new z.ZodError(error.issues.map(issue => ({ ...issue, path: ['operations', index, 'properties', ...issue.path] })));
    throw error;
  }
}
export function applyAiResult(source: PrototypeDocument, result: AiResult) {
  resultSchema.parse(result);
  const doc = structuredClone(source); const changedIds = new Set<string>();
  if (!result.operations.length) return { document: doc, changedIds: [], changed: false };
  for (const [index, op] of result.operations.entries()) {
    let properties;
    try { properties = JSON.parse(op.properties || '{}'); }
    catch { throw Error(`第 ${index + 1} 条操作的 properties 必须是有效的 JSON 对象字符串`); }
    if (op.type === 'addElement') {
      if (!op.targetId || doc.elements.some(e => e.id === op.targetId) || doc.dialogs?.some(d => d.id === op.targetId)) throw Error('新增元素的 ID 已存在或为空');
      elementSchema.shape.kind.parse(op.kind);
      const patch = parseProperties(elementPatch, properties, index);
      const { table, ...attributes } = patch;
      const element = makeElement(op.kind as ElementKind);
      doc.elements.push({ ...element, ...attributes, ...(attributes.component ? { component: { ...element.component, ...attributes.component } } : {}), ...(table ? { table: { columns: [], rows: [], pageSize: 5, ...table } } : {}), id: op.targetId }); changedIds.add(op.targetId);
    } else if (op.type === 'updateElement' || op.type === 'removeElement') {
      const target = doc.elements.find(e => e.id === op.targetId);
      if (!target) throw Error('修改目标不存在');
      if (target.locked) throw Error(`“${target.name}”已锁定，请先解锁再修改`);
      if (op.type === 'removeElement') doc.elements = doc.elements.filter(e => e.id !== op.targetId);
      else {
        const patch = parseProperties(elementPatch, properties, index);
        const table = patch.table ? { columns: [], rows: [], pageSize: 5, ...target.table, ...patch.table } : target.table;
        const component = patch.component ? { ...target.component, ...patch.component } : target.component;
        Object.assign(target, patch);
        if (patch.table) target.table = table;
        if (patch.component) target.component = component;
      }
      changedIds.add(op.targetId);
    } else if (op.type === 'upsertDialog') {
      if (!op.targetId || doc.elements.some(e => e.id === op.targetId)) throw Error('弹窗 ID 为空或与元素重复');
      const patch = parseProperties(dialogPatch, properties, index);
      const target = doc.dialogs?.find(d => d.id === op.targetId);
      if (target) Object.assign(target, patch);
      else (doc.dialogs ||= []).push({ id: op.targetId, title: '新建弹窗', width: 472, height: 400, background: '#ffffff', ...patch });
    } else Object.assign(doc, parseProperties(pagePatch, properties, index));
  }
  documentSchema.parse(doc);
  const elements = new Map(doc.elements.map(e => [e.id, e]));
  const dialogIds = new Set(doc.dialogs?.map(d => d.id));
  for (const e of doc.elements) {
    if (changedIds.has(e.id) && e.fontSize < 12) throw Error('文字字号不能小于 12px');
    if (dialogIds.has(e.id)) throw Error('元素与弹窗 ID 不能重复');
    if (e.action === 'modal' && (!e.modalId || !dialogIds.has(e.modalId))) throw Error(`“${e.name}”引用的弹窗不存在`);
    if (['toggle', 'filter', 'reset'].includes(e.action) && (!e.targetId || !elements.has(e.targetId))) throw Error(`“${e.name}”引用的目标不存在`);
    if (['filter', 'reset'].includes(e.action) && elements.get(e.targetId!)?.kind !== 'table') throw Error('查询和重置必须关联表格');
    if (['updateRow', 'deleteRow'].includes(e.action) && !e.parentId) throw Error('更新或删除当前行必须配置在弹窗内');
    const conditions = [e.visibleWhen, ...(e.table?.columns.map(c => c.visibleWhen) || []), ...(e.table?.filters?.map(f => f.when) || []), ...(e.table?.columnControls?.map(c => c.when) || [])];
    for (const condition of conditions) if (condition && !elements.has(condition.sourceId)) throw Error('显示或筛选条件引用的组件不存在');
    for (const ref of [...(e.table?.filters || []), ...(e.table?.columnControls || [])]) if (!elements.has(ref.sourceId)) throw Error('表格关联的组件不存在');
    const options = e.choices?.options || e.select?.options;
    if (options) {
      const ids = new Set(options.map(o => o.id));
      if (ids.size !== options.length) throw Error('选项值不能重复');
      const defaults = e.choices?.defaultValues || e.select?.defaultValues || [];
      if (defaults.some(id => !ids.has(id))) throw Error('默认选中项不存在');
    }
    if (e.kind === 'tree' && e.choices) for (const option of e.choices.options) {
      const visited = new Set([option.id]); let parent = option.parentId;
      while (parent) { if (visited.has(parent)) throw Error('树节点不能循环嵌套'); visited.add(parent); const found = e.choices.options.find(o => o.id === parent); if (!found) throw Error('树的上级节点不存在'); parent = found.parentId; }
    }
  }
  return { document: doc, changedIds: [...changedIds].filter(id => elements.has(id)), changed: canonicalDocument(doc) !== canonicalDocument(source) };
}
