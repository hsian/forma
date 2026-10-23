import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../server/db';
import { projects, pages, documents } from '../server/db/schema';
import { documentSchema } from '../server/document-validation';
import { bankConnectDocument } from '../examples/bank-connect';

// 一次性本地数据导入；只追加指定项目的新页面，不修改已有文档或登录信息。
const projectId = process.argv[2];
if (!projectId) throw Error('请指定目标项目 ID');
const inputs = [{ name: '账户流水明细查询', document: documentSchema.parse(bankConnectDocument(false)) }, { name: '交易明细转出纳账', document: documentSchema.parse(bankConnectDocument(true)) }];
const connection = openDatabase();
try {
  const { db, sqlite } = connection;
  if (!db.select().from(projects).where(eq(projects.id, projectId)).get()) throw Error('项目不存在');
  const existing = db.select().from(pages).where(eq(pages.projectId, projectId)).all();
  if (existing.some(page => inputs.some(input => input.name === page.name))) throw Error('已有同名页面，停止导入以保留现有内容');
  mkdirSync('data/backups', { recursive: true });
  const backup = resolve('data/backups', `before-bank-connect-${Date.now()}.db`);
  await sqlite.backup(backup);
  const result = db.transaction(tx => {
    const current = tx.select().from(pages).where(eq(pages.projectId, projectId)).all();
    if (current.some(page => inputs.some(input => input.name === page.name))) throw Error('已有同名页面');
    const position = Math.max(-1, ...current.filter(page => !page.parentId).map(page => page.position)) + 1;
    return inputs.map((input, index) => {
      const id = randomUUID(), now = Date.now();
      tx.insert(pages).values({ id, projectId, name: input.name, position: position + index, createdAt: now, updatedAt: now }).run();
      tx.insert(documents).values({ pageId: id, content: input.document, revision: 1, updatedAt: now }).run();
      tx.update(projects).set({ updatedAt: now }).where(eq(projects.id, projectId)).run();
      return { id, name: input.name, elements: input.document.elements.length, dialogs: input.document.dialogs?.length };
    });
  });
  console.log(JSON.stringify({ projectId, backup, pages: result }));
} finally { connection.close(); }
