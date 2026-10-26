import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openSketch } from '../server/sketch/archive';
import { convertSketchBoard } from '../server/sketch/convert';
import { documentSchema } from '../server/document-validation';
import { openDatabase } from '../server/db';
import { projects, pages, documents } from '../server/db/schema';

// Explicit local import of the agreed sample, not a public upload endpoint.
const [file, projectId, ...flags] = process.argv.slice(2);
if (!file || !projectId) throw Error('用法：npx tsx scripts/import-sketch-voucher.ts <sketch文件> <项目ID> [--analyze]');
const archive = openSketch(file);
const name = '凭证模板 · Sketch 导入';
const boardName = '凭证模板-鼠标移上去到编辑按钮的状态';
const panelGroup = '8654BD76-191C-4578-B170-2F7FD8D5D75F';
const converted = convertSketchBoard(archive, '凭证模板', boardName);
const panel = convertSketchBoard(archive, '凭证模板', boardName, panelGroup);
const doc = converted.document;
// The source is a design of an already-open popup. Move that group into an
// editable dialog, and bind the existing trigger instead of importing it open.
doc.elements = doc.elements.filter(e => !e.source?.groups.some(g => g.id === panelGroup));
const dialogId = 'sketch-voucher-template-dialog';
doc.dialogs = [{ id: dialogId, title: '选择会计凭证模板', width: panel.document.width, height: panel.document.height, background: '#ffffff' }];
const panelElements = panel.document.elements.filter(e => e.text !== '选择会计凭证模板');
for (const e of panelElements) {
  e.id = `dialog-${e.id}`; e.parentId = dialogId;
  if (e.text === '取消') e.action = 'closeModal';
  if (e.text === '使用') { e.action = 'submit'; e.actionText = '已选择凭证模板（原型演示）'; }
}
doc.elements.push(...panelElements);
// Promote only explicitly identified controls in this sample. An arbitrary
// rectangle with a label is not sufficient evidence of an interactive control.
function promote(label: string, parentId?: string, kind: 'button' | 'input' = 'button') {
  const text = doc.elements.find(e => e.text === label && e.parentId === parentId);
  if (!text) return;
  const background = doc.elements.filter(e => e.parentId===parentId && (e.kind==='rectangle' || e.kind==='vector' && /矩形/.test(e.name)) && e.width>=text.width && e.x<=text.x && e.y<=text.y && e.x+e.width>=text.x+text.width && e.y+e.height>=text.y+text.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0];
  if (!background) return;
  doc.elements = doc.elements.filter(e => e.id !== background.id);
  Object.assign(text, { kind, x:background.x, y:background.y, width:background.width, height:background.height, fill:background.fill, stroke:background.stroke, strokeWidth:background.strokeWidth, radius:background.radius, typography:undefined });
  if (kind === 'button') text.component = { type:'default' };
  else { text.component = { allowClear:true }; text.action='none'; }
}
promote('使用凭证模板');
for (const label of ['取消', '使用', '重置', '搜索', '新增模块']) promote(label, dialogId);
promote('请输入搜索关键字', dialogId, 'input');
for (const e of doc.elements.filter(e=>e.parentId===dialogId && ['搜索','重置','新增模块'].includes(e.text))) {
  e.action='toast';e.actionText=`${e.text}（原型演示）`;
}
const trigger = doc.elements.find(e => e.text === '使用凭证模板');
if (!trigger) throw Error('未找到使用凭证模板入口，停止导入');
const triggerGroup = trigger.source?.groups.at(-1)?.id;
for (const e of doc.elements.filter(e => e.id === trigger.id || triggerGroup && e.source?.groups.some(g => g.id === triggerGroup))) {
  e.action = 'modal'; e.modalId = dialogId; e.actionText = '选择会计凭证模板';
}
const validated = documentSchema.parse(doc);
mkdirSync('test-results/sketch-analysis', { recursive: true });
writeFileSync('test-results/sketch-analysis/document.json', JSON.stringify(validated));
writeFileSync('test-results/sketch-analysis/report.json', JSON.stringify({ main: converted.report, dialog: panel.report }, null, 2));
if (flags.includes('--analyze')) { console.log(JSON.stringify({ name, elements: validated.elements.length, reports: [converted.report, panel.report] })); process.exit(0); }
const connection = openDatabase();
try {
  const { db, sqlite } = connection;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw Error('目标项目不存在');
  const existing = db.select().from(pages).where(eq(pages.projectId, projectId)).all();
  if (existing.some(p => p.name === name)) throw Error('目标项目已有同名页面，停止导入');
  mkdirSync('data/backups', { recursive: true });
  const backup = resolve('data/backups', `before-sketch-voucher-${Date.now()}.db`);
  await sqlite.backup(backup);
  const id = randomUUID(), now = Date.now();
  db.transaction(tx => {
    const current = tx.select().from(pages).where(eq(pages.projectId, projectId)).all();
    if(current.some(p => p.name === name))throw Error('目标项目已有同名页面');
    tx.insert(pages).values({ id, projectId, name, position: Math.max(-1,...current.filter(p=>!p.parentId).map(p=>p.position))+1, createdAt:now, updatedAt:now }).run();
    tx.insert(documents).values({ pageId:id, content:validated, revision:1, updatedAt:now }).run();
    tx.update(projects).set({ updatedAt:now }).where(eq(projects.id,projectId)).run();
  });
  console.log(JSON.stringify({ project:project.name, projectId, pageId:id, name, backup, elements:validated.elements.length, dialogs:validated.dialogs?.length }));
} finally { connection.close(); }
