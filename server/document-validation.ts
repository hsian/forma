import { z } from 'zod';

const id = z.string().min(1).max(200);
const dimension = z.number().finite().min(1).max(20000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const condition = z.object({ sourceId: id, value: z.string() });
export const elementSchema = z.object({
  id, kind: z.enum(['rectangle', 'ellipse', 'text', 'line', 'button', 'input', 'select', 'switch', 'table', 'tabs', 'tree', 'checkbox']),
  name: z.string().max(2000), x: z.number().finite(), y: z.number().finite(),
  width: dimension, height: dimension, rotation: z.number().finite(),
  text: z.string().max(100000), fill: color, color, stroke: color,
  strokeWidth: z.number().finite().min(0), radius: z.number().finite().min(0), fontSize: z.number().finite().min(1),
  opacity: z.number().finite().min(0).max(1), hidden: z.boolean(), locked: z.boolean(),
  action: z.enum(['none', 'modal', 'toast', 'toggle', 'closeModal', 'submit', 'filter', 'reset', 'apply', 'updateRow', 'deleteRow']),
  targetId: id.optional(), actionText: z.string().max(100000), modalId: id.optional(), parentId: id.optional(),
  required: z.boolean().optional(), inputType: z.enum(['text', 'email']).optional(),
  rowField: id.optional(),
  select: z.object({
    options: z.array(z.object({ id, label: z.string().max(2000) })).max(10000),
    defaultValues: z.array(id).max(10000), multiple: z.boolean(), allowClear: z.boolean(), disabled: z.boolean(),
  }).optional(),
  visibleWhen: condition.optional(),
  choices: z.object({ options: z.array(z.object({ id, label: z.string().max(2000), parentId: id.optional() })).max(10000), defaultValues: z.array(id), requiredAny: z.array(id).optional() }).optional(),
  table: z.object({
    columns: z.array(z.object({ key: id, title: z.string().max(2000), width: dimension.optional(), visibleWhen: condition.optional() })).max(200),
    rows: z.array(z.record(z.string(), z.string())).max(10000), pageSize: z.number().int().min(1).max(100),
    filters: z.array(z.object({ sourceId: id, fields: z.array(id), mode: z.enum(['contains', 'equals']), live: z.boolean(), when: condition.optional() })).optional(),
    columnControls: z.array(z.object({ sourceId: id, when: condition.optional() })).optional(),
    rowActionText: z.string().optional(), rowMessage: z.string().optional(),
    rowActions: z.array(z.object({ id, label: z.string().max(2000), action: z.enum(['modal', 'toast']), modalId: id.optional(), message: z.string().max(100000).optional() }).strict()).max(30).optional(),
  }).optional(),
});
export const documentSchema = z.object({
  width: dimension, height: dimension, background: color,
  elements: z.array(elementSchema).max(20000),
  dialogs: z.array(z.object({ id, title: z.string().max(2000), width: dimension, height: dimension, background: color })).max(2000).optional(),
}).superRefine((doc, context) => {
  const ids = doc.elements.map(e => e.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '元素 ID 必须唯一', path: ['elements'] });
  const dialogs = doc.dialogs || [];
  const dialogIds = new Set(dialogs.map(dialog => dialog.id));
  if (dialogIds.size !== dialogs.length) context.addIssue({ code: 'custom', message: '弹窗 ID 必须唯一', path: ['dialogs'] });
  doc.elements.forEach((e, index) => {
    if (e.parentId && !dialogIds.has(e.parentId)) context.addIssue({ code: 'custom', message: '元素所属弹窗不存在', path: ['elements', index, 'parentId'] });
    if (e.select && new Set(e.select.options.map(option => option.id)).size !== e.select.options.length) context.addIssue({ code: 'custom', message: '选项 ID 必须唯一', path: ['elements', index, 'select', 'options'] });
    if (e.table?.rowActions) {
      if (new Set(e.table.rowActions.map(a => a.id)).size !== e.table.rowActions.length) context.addIssue({ code: 'custom', message: '行操作 ID 必须唯一', path: ['elements', index, 'table', 'rowActions'] });
      for (const action of e.table.rowActions) if (action.action === 'modal' && (!action.modalId || !dialogIds.has(action.modalId))) context.addIssue({ code: 'custom', message: '行操作引用的弹窗不存在', path: ['elements', index, 'table', 'rowActions'] });
    }
  });
});
export const saveDocumentSchema = z.object({ revision: z.number().int().nonnegative(), document: documentSchema });
