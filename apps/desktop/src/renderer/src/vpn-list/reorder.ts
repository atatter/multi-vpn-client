import { placeVpn, type Config } from '@repo/core';

/** Where a dragged row lands: after every other row whose middle is above the dragged row's middle. */
export function orderWhileDragging(order: readonly string[], id: string, center: number, middleOf: (id: string) => number | undefined): string[] {
  const others = order.filter((other) => other !== id);
  const index = others.filter((other) => {
    const middle = middleOf(other);
    return middle !== undefined && middle < center;
  }).length;
  return [...others.slice(0, index), id, ...others.slice(index)];
}

/** The order after moving `id` one step up (-1) or down (+1); undefined when it's already at that end. */
export function orderAfterStep(order: readonly string[], id: string, step: -1 | 1): string[] | undefined {
  const to = order.indexOf(id) + step;
  if (to < 0 || to >= order.length) return undefined;
  const next = order.filter((other) => other !== id);
  next.splice(to, 0, id);
  return next;
}

/** The priority to save once `moved` sits in `ids`: just above the VPN after it, or below the one before it. */
export function priorityAfterMove(config: Config, ids: readonly string[], moved: string): string[] {
  const index = ids.indexOf(moved);
  const next = ids[index + 1];
  const previous = ids[index - 1];
  return next ? placeVpn(config, moved, next, 'above') : previous ? placeVpn(config, moved, previous, 'below') : config.priority;
}
