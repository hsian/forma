import type { PrototypeDocument, PrototypeElement } from './model';
import { randomId } from './uuid';

export interface PersonalComponent { id: string; name: string; document: PrototypeDocument; revision: number; updatedAt: number }

/** Copy only references carried by the selection; never bind a new page to old IDs. */
function remap(element: PrototypeElement, ids: Map<string, string>) {
  const ref = (id?: string) => id ? ids.get(id) : undefined;
  element.id = ids.get(element.id)!;
  element.parentId = ref(element.parentId);
  element.source = undefined;
  element.targetId = ref(element.targetId);
  element.modalId = ref(element.modalId);
  if (element.action === 'modal' && !element.modalId || ['toggle', 'filter', 'reset'].includes(element.action) && !element.targetId) element.action = 'none';
  const condition = (value: PrototypeElement['visibleWhen']) => value && ref(value.sourceId) ? { ...value, sourceId: ref(value.sourceId)! } : undefined;
  element.visibleWhen = condition(element.visibleWhen);
  if (element.table) {
    for (const column of element.table.columns) column.visibleWhen = condition(column.visibleWhen);
    element.table.filters = element.table.filters?.filter(item => ref(item.sourceId)).map(item => ({ ...item, sourceId: ref(item.sourceId)!, when: condition(item.when) }));
    element.table.columnControls = element.table.columnControls?.filter(item => ref(item.sourceId)).map(item => ({ ...item, sourceId: ref(item.sourceId)!, when: condition(item.when) }));
    element.table.rowActions = element.table.rowActions?.filter(item => item.action !== 'modal' || ref(item.modalId)).map(item => ({ ...item, modalId: ref(item.modalId) }));
  }
}

export function captureComponent(doc: PrototypeDocument, selection: string[]): PrototypeDocument {
  const roots = doc.elements.filter(element => selection.includes(element.id));
  if (!roots.length) throw Error('请先选中要保存的元素');
  const dialogs = new Set<string>();
  const includeDialogs = (elements: PrototypeElement[]) => {
    for (const element of elements) {
      for (const id of [element.modalId, ...(element.table?.rowActions || []).map(action => action.modalId)]) {
        if (!id || dialogs.has(id) || !doc.dialogs?.some(dialog => dialog.id === id)) continue;
        dialogs.add(id);
        includeDialogs(doc.elements.filter(child => child.parentId === id));
      }
    }
  };
  includeDialogs(roots);
  const x = Math.min(...roots.map(element => element.x));
  const y = Math.min(...roots.map(element => element.y));
  const result: PrototypeDocument = {
    width: Math.max(1, ...roots.map(element => element.x + element.width - x)),
    height: Math.max(1, ...roots.map(element => element.y + element.height - y)), background: '#ffffff',
    elements: structuredClone(doc.elements.filter(element => selection.includes(element.id) || !!element.parentId && dialogs.has(element.parentId))),
    dialogs: structuredClone(doc.dialogs?.filter(dialog => dialogs.has(dialog.id)) || []),
  };
  // The selected surface becomes the template's root surface.
  for (const element of result.elements) if (selection.includes(element.id)) { element.x -= x; element.y -= y; delete element.parentId; }
  const ids = new Map([...result.elements, ...result.dialogs!].map(item => [item.id, randomId()]));
  result.elements.forEach(element => remap(element, ids));
  result.dialogs!.forEach(dialog => { dialog.id = ids.get(dialog.id)!; });
  return result;
}

export function instantiateComponent(template: PrototypeDocument, x = 24, y = 24, parentId?: string) {
  const copy = structuredClone(template);
  const ids = new Map([...copy.elements, ...(copy.dialogs || [])].map(item => [item.id, randomId()]));
  const selected: string[] = [];
  for (const element of copy.elements) {
    const root = !element.parentId;
    remap(element, ids);
    if (root) { element.x += Math.round(x); element.y += Math.round(y); element.parentId = parentId; element.locked = false; selected.push(element.id); }
  }
  copy.dialogs?.forEach(dialog => { dialog.id = ids.get(dialog.id)!; });
  return { elements: copy.elements, dialogs: copy.dialogs || [], selected };
}
