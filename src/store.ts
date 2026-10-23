import { create } from 'zustand';
import { seedDocument, type PrototypeDocument, type PrototypeElement } from '../shared/model';
type State = {
  editSerial: number;
  readOnly: boolean; setReadOnly: (value: boolean) => void;
  doc: PrototypeDocument; selected: string[]; past: PrototypeDocument[]; future: PrototypeDocument[];
  replace: (doc: PrototypeDocument) => void; select: (ids: string[]) => void;
  commit: (fn: (doc: PrototypeDocument) => void) => void;
  patch: (id: string, patch: Partial<PrototypeElement>) => void;
  undo: () => void; redo: () => void;
};
export const useEditor = create<State>((set, get) => ({
  editSerial: 0,
  readOnly: false, setReadOnly: readOnly => set({ readOnly, ...(readOnly ? { selected: [] } : {}) }),
  doc: structuredClone(seedDocument), selected: [], past: [], future: [],
  replace: doc => set({ doc, selected: [], past: [], future: [] }),
  select: selected => set({ selected }),
  commit: fn => { const { doc, past, readOnly, editSerial } = get(); if (readOnly) return; const next = structuredClone(doc); fn(next); if (JSON.stringify(next) === JSON.stringify(doc)) return; set({ doc: next, past: [...past.slice(-99), doc], future: [], editSerial: editSerial + 1 }); },
  patch: (id, patch) => get().commit(doc => { const el = doc.elements.find(el => el.id === id); if (el) Object.assign(el, patch); }),
  undo: () => { const { past, doc, future, readOnly, editSerial } = get(); if (readOnly || !past.length) return; const previous = past[past.length - 1]; set({ doc: previous, past: past.slice(0, -1), future: [doc, ...future], selected: [] , editSerial: editSerial + 1 }); },
  redo: () => { const { past, doc, future, readOnly, editSerial } = get(); if (readOnly || !future.length) return; set({ doc: future[0], past: [...past, doc], future: future.slice(1), selected: [] , editSerial: editSerial + 1 }); },
}));
