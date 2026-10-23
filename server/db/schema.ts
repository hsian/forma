import { sqliteTable, text, integer, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { PrototypeDocument } from '../../shared/model.js';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(), role: text('role').$type<'admin' | 'member'>().notNull(),
  createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').references(() => users.id),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const projectMembers = sqliteTable('project_members', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'admin' | 'editor' | 'viewer'>().notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.userId] })]);
export const folders = sqliteTable('folders', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  parentId: text('parent_id').references((): AnySQLiteColumn => pages.id),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const documents = sqliteTable('documents', {
  pageId: text('page_id').primaryKey().references(() => pages.id, { onDelete: 'cascade' }),
  content: text('content', { mode: 'json' }).$type<PrototypeDocument>().notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});
export const pageLeases = sqliteTable('page_leases', {
  pageId: text('page_id').primaryKey().references(() => pages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionHash: text('session_hash').notNull().references(() => sessions.tokenHash, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(), expiresAt: integer('expires_at').notNull(),
});
export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  storagePath: text('storage_path').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(), status: text('status').notNull(), provider: text('provider').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});
