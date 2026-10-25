import { newRoute, newVpn, type Config, type RouteRule } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { withPinnedRule } from './pin-rule.ts';

const vpn = newVpn('openvpn', { id: 'b', name: 'Client B' });
const own: RouteRule = { ...newRoute('10.143.1.20/32', 'b'), id: 'own' };
const config: Config = { version: 1, vpns: [vpn], routes: [own], priority: [] };

describe('pinning a site', () => {
  it("pins one of the VPN's own sites in place", () => {
    expect(withPinnedRule(config, own).routes).toEqual([{ ...own, pinned: true }]);
  });

  it('turns a rule from the server into a pinned site of its own', () => {
    const fromServer: RouteRule = {
      ...newRoute('10.140.0.0/16', 'b'),
      id: 'server:b:10.140.0.0/16',
    };
    const added = withPinnedRule(config, fromServer).routes.at(-1);
    expect(added).toMatchObject({ vpnId: 'b', kind: 'cidr', cidr: '10.140.0.0/16', pinned: true });
    expect(added?.id).not.toBe(fromServer.id);
  });
});
