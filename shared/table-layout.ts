import type { PrototypeDocument, PrototypeElement } from './model';

/** Keep short legacy tables readable instead of silently hiding their saved rows. */
export function tableLayout(element: PrototypeElement) {
  const table = element.table!;
  const count = table.pagination === false ? table.rows.length : Math.min(table.rows.length, table.pageSize);
  const columnsWidth = Math.max(table.scrollWidth || 0, table.columns.reduce((sum, column) => sum + (column.width || 140), 0));
  const scrollbar = columnsWidth > element.width ? 12 : 0;
  const canFit = count > 0 && element.height - scrollbar >= 24 * (count + 1) + 2;
  const compact = !table.appearance && canFit && element.height < 45 + count * 52 + (table.pagination === false ? 0 : 56);
  const pagination = table.pagination ?? !(compact && table.rows.length <= table.pageSize);
  const headerHeight = compact ? Math.max(24, Math.min(45, Math.floor((element.height - scrollbar - 2) / (count + 1)))) : 45;
  const rowHeight = compact ? Math.max(24, Math.min(52, Math.floor((element.height - scrollbar - 2 - headerHeight - (pagination ? 56 : 0)) / count))) : 52;
  // Earlier image reconstructions stored the header tint in the only available fill.
  // For compact tables without explicit appearance, use that tint on the header,
  // keeping data cells white. Explicit body/header colors always take precedence.
  const legacyColors = compact && element.fill.toLowerCase() !== '#ffffff'
    ? { headerBackground: element.fill, bodyBackground: '#ffffff', borderColor: element.stroke, bordered: element.strokeWidth > 0 }
    : {};
  return { pagination, custom: !!table.appearance || compact || table.scrollWidth !== undefined, columnsWidth, appearance: { headerHeight, rowHeight, ...legacyColors, ...table.appearance } };
}

/** Image reconstructions have no inferred pagination controls unless the model saw them. */
export function prepareImageTables(document: PrototypeDocument) {
  const result = structuredClone(document);
  for (const e of result.elements) {
    if (!e.table) continue;
    e.table.pagination ??= false;
    const layout = tableLayout(e);
    e.table.appearance = { ...layout.appearance, ...e.table.appearance };
  }
  return result;
}
