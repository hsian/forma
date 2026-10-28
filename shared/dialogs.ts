import type { PrototypeDocument } from './model';

/** Remove a page-owned dialog and references to its contents in one undoable edit. */
export function removeDialog(doc: PrototypeDocument, dialogId: string) {
  if (!doc.dialogs?.some(dialog => dialog.id === dialogId)) return;
  const children = new Set(doc.elements.filter(element => element.parentId === dialogId).map(element => element.id));
  doc.dialogs = doc.dialogs.filter(dialog => dialog.id !== dialogId);
  doc.elements = doc.elements.filter(element => !children.has(element.id));
  if (doc.annotations) doc.annotations = doc.annotations.filter(note => note.dialogId !== dialogId);
  for (const element of doc.elements) {
    if (element.modalId === dialogId) {
      delete element.modalId;
      if (element.action === 'modal') { element.action = 'none'; element.actionText = ''; }
    }
    if (element.targetId && children.has(element.targetId)) {
      delete element.targetId;
      if (['toggle', 'filter', 'reset'].includes(element.action)) element.action = 'none';
    }
    if (element.visibleWhen && children.has(element.visibleWhen.sourceId)) delete element.visibleWhen;
    const table = element.table;
    if (!table) continue;
    // A row action cannot open a missing dialog; remove that action only.
    if (table.rowActions) table.rowActions = table.rowActions.filter(action => action.modalId !== dialogId);
    for (const column of table.columns) if (column.visibleWhen && children.has(column.visibleWhen.sourceId)) delete column.visibleWhen;
    if (table.filters) table.filters = table.filters.filter(filter => !children.has(filter.sourceId));
    if (table.columnControls) table.columnControls = table.columnControls.filter(control => !children.has(control.sourceId));
    for (const ref of [...(table.filters || []), ...(table.columnControls || [])]) {
      if (ref.when && children.has(ref.when.sourceId)) delete ref.when;
    }
  }
}
