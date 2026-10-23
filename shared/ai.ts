import type { PrototypeDocument } from './model';
export interface AiOperation { type: 'addElement' | 'updateElement' | 'removeElement' | 'upsertDialog' | 'updatePage'; targetId: string; kind: string; properties: string }
export interface AiResult { reply: string; operations: AiOperation[] }
export interface AiMessage { id: string; role: 'user' | 'assistant'; content: string; status: string; provider: string; createdAt: number }
export type AiEvent = { type: 'status'; text: string } | { type: 'text'; text: string; reset?: boolean } | { type: 'error'; text: string } | { type: 'result'; message: AiMessage; document: PrototypeDocument; changedIds: string[]; changed: boolean };
export const aiResultJsonSchema = {
  type: 'object', additionalProperties: false, required: ['reply', 'operations'],
  properties: { reply: { type: 'string' }, operations: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['type', 'targetId', 'kind', 'properties'],
    properties: { type: { type: 'string', enum: ['addElement', 'updateElement', 'removeElement', 'upsertDialog', 'updatePage'] }, targetId: { type: 'string' }, kind: { type: 'string' }, properties: { type: 'string' } },
  } } },
};
export const canonicalDocument = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
