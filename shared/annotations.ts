import { randomId } from './uuid.js';
import type { PrototypeAnnotation, PrototypeDocument } from './model';

export function surfaceAnnotations(doc: PrototypeDocument, dialogId?: string) {
  return (doc.annotations || []).filter(note => note.dialogId === dialogId);
}
export function addAnnotation(doc: PrototypeDocument, point: { x: number; y: number }, dialogId?: string): PrototypeAnnotation | undefined {
  if ((doc.annotations?.length || 0) >= 500) return;
  const note: PrototypeAnnotation = { id: randomId(), number: Math.max(0, ...(doc.annotations || []).map(note => note.number)) + 1, x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)), title: '', content: '', ...(dialogId ? { dialogId } : {}) };
  (doc.annotations ||= []).push(note);
  return note;
}
