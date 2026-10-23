import { create } from 'zustand';
import { seedDocument, type PrototypeDocument, type PrototypeElement } from '../shared/model';
type State = {
  doc: PrototypeDocument; selected: string[]; past: PrototypeDocument[]; future: PrototypeDocument[];
  replace: (doc: PrototypeDocument) => void; select: (ids: string[]) => void;
  commit: (fn: (doc: PrototypeDocument) => void) => void;
  patch: (id: string, patch: Partial<PrototypeElement>) => void;
  undo: () => void; redo: () => void;
};
export const useEditor = create<State>((set, get) => ({
  doc: structuredClone(seedDocument), selected: [], past: [], future: [],
  replace: doc => set({ doc, selected: [], past: [], future: [] }),
  select: selected => set({ selected }),
  commit: fn => { const { doc, past } = get(); const next = structuredClone(doc); fn(next); if (JSON.stringify(next) === JSON.stringify(doc)) return; set({ doc: next, past: [...past.slice(-99), doc], future: [] }); },
  patch: (id, patch) => get().commit(doc => { const el = doc.elements.find(el => el.id === id); if (el) Object.assign(el, patch); }),
  undo: () => { const { past, doc, future } = get(); if (!past.length) return; const previous = past[past.length - 1]; set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], selected: [] }); },
  redo: () => { const { past, doc, future } = get(); if (!future.length) return; set({ doc: future[0], past: [...past, doc], future: future.slice(1), selected: [] }); },
}));
