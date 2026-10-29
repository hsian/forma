import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './index.js';
import type { PrototypeDocument } from '../../shared/model.js';
import { personalComponents } from './schema.js';

export function createPersonalComponentRepository(db: AppDatabase) {
  return {
    listPersonalComponents(ownerId: string) { return db.select().from(personalComponents).where(eq(personalComponents.ownerId, ownerId)).orderBy(desc(personalComponents.updatedAt)).all(); },
    savePersonalComponent(ownerId: string, name: string, document: PrototypeDocument, id?: string, revision?: number) {
      if (!id) return db.insert(personalComponents).values({ id: randomUUID(), ownerId, name, document, revision: 1, updatedAt: Date.now() }).returning().get();
      return db.update(personalComponents).set({ name, document, revision: (revision || 0) + 1, updatedAt: Date.now() }).where(and(eq(personalComponents.id, id), eq(personalComponents.ownerId, ownerId), eq(personalComponents.revision, revision || 0))).returning().get();
    },
    deletePersonalComponent(ownerId: string, id: string) { return db.delete(personalComponents).where(and(eq(personalComponents.id, id), eq(personalComponents.ownerId, ownerId))).returning().get(); },
  };
}
