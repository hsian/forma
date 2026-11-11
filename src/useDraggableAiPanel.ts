import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Position = { x: number; y: number };
type Size = { width: number; height: number };
export function useDraggableAiPanel(visible: boolean, expanded: boolean) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; start: Position } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const [resizing, setResizing] = useState(false);
  const resize = useRef<{ pointerId: number; x: number; y: number; start: Position; size: Size; direction: string } | null>(null);

  function clamp(value: Position): Position {
    const panel = ref.current, parent = panel?.offsetParent;
    if (!panel || !(parent instanceof HTMLElement) || !panel.getClientRects().length) return value;
    return {
      x: Math.max(8, Math.min(value.x, parent.clientWidth - panel.offsetWidth - 8)),
      y: Math.max(8, Math.min(value.y, parent.clientHeight - panel.offsetHeight - 8)),
    };
  }
  useEffect(() => {
    const panel = ref.current, parent = panel?.offsetParent;
    if (!panel || !(parent instanceof HTMLElement) || !visible) return;
    const observer = new ResizeObserver(() => {
      if (!panel.getClientRects().length || parent.clientWidth <= 16 || parent.clientHeight <= 16) return;
      setSize(old => {
        if (!old) return old;
        const width = Math.min(Math.max(480, old.width), parent.clientWidth - 16), height = Math.min(Math.max(280, old.height), parent.clientHeight - 16);
        return width === old.width && height === old.height ? old : { width, height };
      });
      setPosition(old => {
        if (!old) return old;
        const next = clamp(old);
        return next.x === old.x && next.y === old.y ? old : next;
      });
    });
    observer.observe(panel); observer.observe(parent);
    return () => observer.disconnect();
  }, [visible]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('button,a,input,[role="button"]')) return;
    const panel = ref.current, parent = panel?.offsetParent;
    if (!panel || !(parent instanceof HTMLElement)) return;
    const rect = panel.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    const start = { x: rect.left - bounds.left - parent.clientLeft + parent.scrollLeft, y: rect.top - bounds.top - parent.clientTop + parent.scrollTop };
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start };
    setPosition(start); setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointerId) return;
    setPosition(clamp({ x: start.start.x + event.clientX - start.x, y: start.start.y + event.clientY - start.y }));
    event.preventDefault(); event.stopPropagation();
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function resizeStart(event: PointerEvent<HTMLDivElement>, direction: string) {
    if (event.button !== 0 || !event.isPrimary) return;
    const panel = ref.current, parent = panel?.offsetParent;
    if (!panel || !(parent instanceof HTMLElement)) return;
    const rect = panel.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    const start = { x: rect.left - bounds.left - parent.clientLeft + parent.scrollLeft, y: rect.top - bounds.top - parent.clientTop + parent.scrollTop };
    resize.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start, size: { width: rect.width, height: rect.height }, direction };
    setPosition(start); setSize({ width: rect.width, height: rect.height }); setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault(); event.stopPropagation();
  }
  function resizeMove(event: PointerEvent<HTMLDivElement>) {
    const start = resize.current, parent = ref.current?.offsetParent;
    if (!start || start.pointerId !== event.pointerId || !(parent instanceof HTMLElement)) return;
    const maxWidth = parent.clientWidth - start.start.x - 8, maxHeight = parent.clientHeight - start.start.y - 8;
    setSize({
      width: Math.max(Math.min(480, maxWidth), Math.min(maxWidth, start.size.width + (start.direction.includes('e') ? event.clientX - start.x : 0))),
      height: Math.max(Math.min(280, maxHeight), Math.min(maxHeight, start.size.height + (start.direction.includes('s') ? event.clientY - start.y : 0))),
    });
    event.preventDefault(); event.stopPropagation();
  }
  function resizeEnd(event: PointerEvent<HTMLDivElement>) {
    if (resize.current?.pointerId !== event.pointerId) return;
    resize.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return {
    ref, dragging, resizing, sized: !!size && expanded,
    style: { ...(position ? { left: position.x, top: position.y, bottom: 'auto', transform: 'none' } : {}), ...(size ? { width: size.width, ...(expanded ? { height: size.height } : {}) } : {}) },
    handle: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end },
    resizeHandle: (direction: string) => ({ onPointerDown: (event: PointerEvent<HTMLDivElement>) => resizeStart(event, direction), onPointerMove: resizeMove, onPointerUp: resizeEnd, onPointerCancel: resizeEnd, onLostPointerCapture: resizeEnd }),
  };
}
