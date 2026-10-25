import { newVpn, type Config } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { orderAfterStep, orderWhileDragging, priorityAfterMove } from './reorder.ts';

describe('reordering', () => {
  it('steps a row up or down, and not past either end', () => {
    expect(orderAfterStep(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(orderAfterStep(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(orderAfterStep(['a', 'b', 'c'], 'a', -1)).toBeUndefined();
    expect(orderAfterStep(['a', 'b', 'c'], 'c', 1)).toBeUndefined();
  });

  it('drops a dragged row after every row whose middle is above its own', () => {
    const middles: Record<string, number> = { a: 29, b: 87, c: 145 };
    expect(orderWhileDragging(['a', 'b', 'c'], 'a', 120, (id) => middles[id])).toEqual(['b', 'a', 'c']);
    expect(orderWhileDragging(['a', 'b', 'c'], 'c', 10, (id) => middles[id])).toEqual(['c', 'a', 'b']);
  });

  it('saves a moved VPN just above the one after it, or below the one before it', () => {
    const vpns = ['a', 'b', 'c'].map((id) => newVpn('openvpn', { id, name: id }));
    const config: Config = { version: 1, vpns, routes: [], priority: ['a', 'b', 'c'] };
    expect(priorityAfterMove(config, ['b', 'a', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(priorityAfterMove(config, ['a', 'c', 'b'], 'b')).toEqual(['a', 'c', 'b']);
  });
});
