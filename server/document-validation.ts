import { z } from 'zod';
import { elementKinds } from '../shared/model.js';
import { componentIssues } from '../shared/antd-catalog.js';

const id = z.string().min(1).max(200);
const dimension = z.number().finite().min(1).max(20000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const condition = z.object({ sourceId: id, value: z.string() });
const paint=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('solid'),color,opacity:z.number().min(0).max(1)}).strict(),
 z.object({kind:z.enum(['linear','radial']),from:z.tuple([z.number().finite(),z.number().finite()]),to:z.tuple([z.number().finite(),z.number().finite()]),opacity:z.number().min(0).max(1),stops:z.array(z.object({offset:z.number().min(0).max(1),color,opacity:z.number().min(0).max(1)}).strict()).max(100)}).strict()
]);
export const elementSchema = z.object({
  id, kind: z.enum(elementKinds),
  name: z.string().max(2000), x: z.number().finite(), y: z.number().finite(),
  width: dimension, height: dimension, rotation: z.number().finite(),
  text: z.string().max(100000), fill: color, color, stroke: color,
  strokeWidth: z.number().finite().min(0), radius: z.number().finite().min(0), fontSize: z.number().finite().min(1),
  opacity: z.number().finite().min(0).max(1), hidden: z.boolean(), locked: z.boolean(),
  action: z.enum(['none', 'modal', 'toast', 'toggle', 'closeModal', 'submit', 'filter', 'reset', 'apply', 'updateRow', 'deleteRow']),
  targetId: id.optional(), actionText: z.string().max(100000), modalId: id.optional(), parentId: id.optional(),
  required: z.boolean().optional(), inputType: z.enum(['text', 'email']).optional(),
  rowField: id.optional(),
  clipRules:z.array(z.enum(['evenodd','nonzero'])).max(30).optional(),
  clipPaths:z.array(z.string().max(1000000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]*$/)).max(30).optional(),
  drawing:z.object({baseFill:color.optional(),baseStroke:color.optional(),baseStrokeWidth:z.number().finite().min(0).optional(),fills:z.array(paint).max(20),strokes:z.array(z.object({paint,width:z.number().min(0).max(20000),position:z.enum(['center','inside','outside']),dash:z.array(z.number().min(0).max(20000)).max(100),cap:z.enum(['butt','round','square']),join:z.enum(['miter','round','bevel'])}).strict()).max(20),shadows:z.array(z.object({x:z.number().finite(),y:z.number().finite(),blur:z.number().min(0).max(20000),spread:z.number().min(-20000).max(20000),color,opacity:z.number().min(0).max(1)}).strict()).max(20)}).strict().optional(),
  vector: z.object({ path: z.string().max(1000000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]*$/), viewWidth: dimension, viewHeight: dimension, fillEnabled: z.boolean(), fillOpacity: z.number().min(0).max(1), strokeOpacity: z.number().min(0).max(1), fillRule: z.enum(['evenodd', 'nonzero']), rectangleRadii:z.tuple([z.number().min(0).max(20000),z.number().min(0).max(20000),z.number().min(0).max(20000),z.number().min(0).max(20000)]).optional() }).strict().optional(),
  typography: z.object({ fontFamily: z.string().max(200), fontWeight: z.number().min(100).max(900), align: z.enum(['left', 'center', 'right']), lineHeight: z.number().min(1).max(1000), sourceFont:z.string().max(200).optional(), fontStyle:z.enum(['normal','italic']).optional(), letterSpacing:z.number().finite().min(-1000).max(1000).optional(), wrap:z.enum(['nowrap','wrap']).optional(), verticalAlign:z.enum(['top','middle','bottom']).optional(),originalText:z.string().max(100000).optional(),baseColor:color.optional(),runs:z.array(z.object({start:z.number().int().min(0),length:z.number().int().min(0),fontFamily:z.string().max(200),fontWeight:z.number().min(100).max(900),fontStyle:z.enum(['normal','italic']),fontScale:z.number().positive().max(100),letterSpacing:z.number().finite(),color,opacity:z.number().min(0).max(1)}).strict()).max(10000).optional() }).strict().optional(),
  importTransform: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  source: z.object({ layerId: id, groups: z.array(z.object({ id, name: z.string().max(2000) })).max(100) }).strict().optional(),
  component: z.record(z.string().max(100), z.union([z.string().max(8 * 1024 * 1024), z.number().finite(), z.boolean(), z.array(z.object({ id, label: z.string().max(2000), description: z.string().max(10000).optional(), parentId: id.optional(), disabled: z.boolean().optional() }).strict()).max(200)])).optional(),
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
  importInfo:z.object({sourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),sourcePageId:id.optional(),sourceBoardId:id.optional(),importedAt:z.number().finite().optional(),importedBy:z.string().max(200).optional(),acknowledgedDifferences:z.boolean().optional(),report:z.object({pageName:z.string().max(2000),boardName:z.string().max(2000),elements:z.number().nonnegative(),skippedOutside:z.number().nonnegative(),skippedHidden:z.number().nonnegative(),warnings:z.array(z.object({message:z.string().max(2000),count:z.number().nonnegative()})).max(500),issues:z.array(z.object({code:z.string().max(100),severity:z.enum(['warning','error']),message:z.string().max(2000),layerId:z.string().max(200),layerName:z.string().max(2000)})).max(10000),converterVersion:z.string().max(100),sourceVersion:z.string().max(100)})}).optional(),
  width: dimension, height: dimension, background: color,
  elements: z.array(elementSchema).max(20000),
  annotations: z.array(z.object({ id, number: z.number().int().min(1).max(1000000000), x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1), title: z.string().max(120), content: z.string().max(5000), dialogId: id.optional() }).strict()).max(500).optional(),
  dialogs: z.array(z.object({ id, title: z.string().max(2000), width: dimension, height: dimension, background: color })).max(2000).optional(),
}).superRefine((doc, context) => {
  const ids = doc.elements.map(e => e.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: '元素 ID 必须唯一', path: ['elements'] });
  const dialogs = doc.dialogs || [];
  const dialogIds = new Set(dialogs.map(dialog => dialog.id));
  if (dialogIds.size !== dialogs.length) context.addIssue({ code: 'custom', message: '弹窗 ID 必须唯一', path: ['dialogs'] });
  const annotations = doc.annotations || [];
  if (new Set(annotations.map(note => note.id)).size !== annotations.length) context.addIssue({ code: 'custom', message: '标注 ID 必须唯一', path: ['annotations'] });
  if (new Set(annotations.map(note => note.number)).size !== annotations.length) context.addIssue({ code: 'custom', message: '标注编号必须唯一', path: ['annotations'] });
  annotations.forEach((note, index) => { if (note.dialogId && !dialogIds.has(note.dialogId)) context.addIssue({ code: 'custom', message: '标注所属弹窗不存在', path: ['annotations', index, 'dialogId'] }); });
  doc.elements.forEach((e, index) => {
    for (const issue of componentIssues(e.kind, e.component || {})) context.addIssue({ code: 'custom', message: issue.message, path: ['elements', index, 'component', issue.key] });
    if (e.parentId && !dialogIds.has(e.parentId)) context.addIssue({ code: 'custom', message: '元素所属弹窗不存在', path: ['elements', index, 'parentId'] });
    if (e.select && new Set(e.select.options.map(option => option.id)).size !== e.select.options.length) context.addIssue({ code: 'custom', message: '选项 ID 必须唯一', path: ['elements', index, 'select', 'options'] });
    if (e.table?.rowActions) {
      if (new Set(e.table.rowActions.map(a => a.id)).size !== e.table.rowActions.length) context.addIssue({ code: 'custom', message: '行操作 ID 必须唯一', path: ['elements', index, 'table', 'rowActions'] });
      for (const action of e.table.rowActions) if (action.action === 'modal' && (!action.modalId || !dialogIds.has(action.modalId))) context.addIssue({ code: 'custom', message: '行操作引用的弹窗不存在', path: ['elements', index, 'table', 'rowActions'] });
    }
  });
});
export const saveDocumentSchema = z.object({ revision: z.number().int().nonnegative(), document: documentSchema });
