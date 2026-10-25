import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { orderAfterStep, orderWhileDragging } from './reorder.ts';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Dragging rows by a grip, or moving them with the keyboard, within one list. While dragging, the order lives
 * here and the dragged row follows the pointer; `commit` gets the new order once it's dropped (or stepped).
 * Rows that move between renders slide from where they were, so a change of section reads as motion.
 */
export function useReorder({
  order: saved,
  commit,
}: {
  order: readonly string[];
  commit: (ids: string[], moved: string) => void;
}) {
  const [dragOrder, setDragOrder] = useState<string[]>();
  /** The row being dragged, for its lifted look. */
  const [lifted, setLifted] = useState<string>();
  const order = dragOrder ?? saved;
  const list = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const drag = useRef<{ id: string; grab: number; top: number } | undefined>(undefined);

  // After each render, keep the dragged row under the pointer, and slide rows that moved from where they were.
  // Positions are relative to the list, so scrolling isn't motion.
  useLayoutEffect(() => {
    const reduced = reducedMotion();

    for (const [id, row] of rows.current) {
      const top = row.offsetTop;
      const before = tops.current.get(id);

      if (drag.current?.id === id) {
        row.style.transform = `translateY(${drag.current.top - top}px)`;
      } else if (before !== undefined && Math.abs(before - top) > 2 && !reduced) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], {
          duration: 220,
          easing: 'cubic-bezier(.2,.7,.2,1)',
        });
      }

      tops.current.set(id, top);
    }
  });

  /** The ref for every row; a row says which one it is with `data-row-id`. */
  const rowRef = (element: HTMLLIElement) => {
    const id = element.dataset.rowId;
    if (!id) {
      return;
    }

    rows.current.set(id, element);

    return () => void rows.current.delete(id);
  };

  const middleOf = (id: string) => {
    const element = rows.current.get(id);
    return element ? element.offsetTop + element.offsetHeight / 2 : undefined;
  };

  const onPointerDown = (id: string, event: PointerEvent<HTMLElement>) => {
    const row = rows.current.get(id);
    if (!row) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id,
      grab: event.clientY - row.getBoundingClientRect().top,
      top: row.offsetTop,
    };
    setLifted(id);
    setDragOrder([...order]);
  };

  const onPointerMove = (id: string, event: PointerEvent<HTMLElement>) => {
    const row = rows.current.get(id);
    if (drag.current?.id !== id || !row || !list.current || !dragOrder) {
      return;
    }

    const top = event.clientY - drag.current.grab - list.current.getBoundingClientRect().top;
    drag.current.top = top;
    const next = orderWhileDragging(dragOrder, id, top + row.offsetHeight / 2, middleOf);
    if (next.join() === dragOrder.join()) {
      row.style.transform = `translateY(${top - row.offsetTop}px)`;
    } else {
      setDragOrder(next);
    }
  };

  const onPointerUp = (id: string) => {
    const row = rows.current.get(id);
    if (drag.current?.id !== id || !row) {
      return;
    }

    const offset = row.style.transform;
    row.style.transform = '';

    if (offset && !reducedMotion()) {
      row.animate([{ transform: offset }, { transform: 'none' }], {
        duration: 160,
        easing: 'ease-out',
      });
    }

    drag.current = undefined;

    if (dragOrder) {
      commit(dragOrder, id);
    }

    setLifted(undefined);
    setDragOrder(undefined);
  };

  /** The keyboard twin of dragging: Alt+↑/↓ anywhere on a row, or ↑/↓ on its grip. */
  const onKeyDown = (id: string, event: KeyboardEvent<HTMLElement>, onGrip: boolean) => {
    if (!onGrip && !event.altKey) {
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }

    const next = orderAfterStep(order, id, event.key === 'ArrowUp' ? -1 : 1);
    if (!next) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commit(next, id);
  };

  /** The row an event came from: rows and their grips say which one they are with `data-row-id`. */
  const idOf = (event: { currentTarget: HTMLElement }) => event.currentTarget.dataset.rowId;

  return {
    order,
    list,
    rowRef,
    isLifted: (id: string) => lifted === id,
    /** For a row: Alt+↑/↓ moves it. */
    onRowKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const id = idOf(event);
      if (id) {
        onKeyDown(id, event, false);
      }
    },
    /** For a row's grip: drag it, or move it with ↑/↓. */
    grip: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const id = idOf(event);
        if (id) {
          onPointerDown(id, event);
        }
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        const id = idOf(event);
        if (id) {
          onPointerMove(id, event);
        }
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        const id = idOf(event);
        if (id) {
          onPointerUp(id);
        }
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => {
        const id = idOf(event);
        if (id) {
          onPointerUp(id);
        }
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        const id = idOf(event);
        if (id) {
          onKeyDown(id, event, true);
        }
      },
    },
  };
}
