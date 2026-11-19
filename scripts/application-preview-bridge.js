// Injected only by the managed development server; never exported to business apps.
if (window.parent !== window) {
  let enabled = false;
  let selectedId = null;
  let allowed = new Set();
  let hovered = null;
  const outlines = ['#635bff', '#9b95ff'].map(color => {
    const node = document.createElement('div');
    node.setAttribute('data-forma-inspector-overlay', '');
    Object.assign(node.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: `2px solid ${color}`, boxSizing: 'border-box', display: 'none' });
    document.documentElement.append(node);
    return node;
  });
  function draw(node, target) {
    if (!enabled || !target?.isConnected || !target.getClientRects().length) { node.style.display = 'none'; return; }
    const rect = target.getBoundingClientRect();
    Object.assign(node.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function update() {
    const selected = [...document.querySelectorAll('[data-preview-id]')].find(node => node.getAttribute('data-preview-id') === selectedId);
    draw(outlines[0], selected);
    draw(outlines[1], hovered === selected ? null : hovered);
  }
  function target(event) {
    const node = event.target instanceof Element ? event.target.closest('[data-preview-id]') : null;
    return node && allowed.has(node.getAttribute('data-preview-id')) ? node : null;
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'forma:inspect-state') return;
    enabled = event.data.enabled === true;
    selectedId = typeof event.data.selectedId === 'string' ? event.data.selectedId : null;
    allowed = new Set(Array.isArray(event.data.ids) ? event.data.ids.filter(id => typeof id === 'string') : []);
    hovered = null; update();
  });
  window.addEventListener('pointermove', event => { if (enabled) { hovered = target(event); update(); } }, true);
  document.addEventListener('pointerleave', () => { hovered = null; update(); });
  // Capture before React/native controls so selecting never submits or activates a control.
  for (const name of ['pointerdown', 'mousedown', 'mouseup', 'dblclick', 'contextmenu']) {
    window.addEventListener(name, event => { if (enabled) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  window.addEventListener('click', event => {
    if (!enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selectedId = target(event)?.getAttribute('data-preview-id') || null;
    update();
    window.parent.postMessage({ type: 'forma:inspect-select', pageId: new URLSearchParams(window.location.hash.slice(1)).get('page'), id: selectedId }, window.location.origin);
  }, true);
  window.addEventListener('keydown', event => {
    if (!enabled) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      selectedId = null; update();
      window.parent.postMessage({ type: 'forma:inspect-select', pageId: new URLSearchParams(window.location.hash.slice(1)).get('page'), id: null }, window.location.origin);
    }
  }, true);
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  new ResizeObserver(update).observe(document.documentElement);
  new MutationObserver(records => { if (records.some(record => !outlines.includes(record.target))) update(); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  window.parent.postMessage({ type: 'forma:inspect-ready' }, window.location.origin);
}
