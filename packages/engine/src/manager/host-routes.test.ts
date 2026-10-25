import { compileRoutes, newVpn, type Config, type RouteRule } from '@repo/core';
import { describe, expect, it, vi } from 'vitest';
import type { VpnSession } from '../container/start.ts';
import { noRoutesWarning, planRoutes } from './host-routes.ts';

vi.mock('@repo/core/host', () => ({
  hostReserved: async () => ({ reserved: [], unresolved: [] }),
}));

const vpn = (id: string) => ({ ...newVpn('openvpn', { id, name: id }), traffic: 'sites' as const });
const cidr = (id: string, vpnId: string, value: string): RouteRule => ({
  id,
  vpnId,
  kind: 'cidr',
  cidr: value,
  enabled: true,
  note: '',
  pinned: false,
});
const LAN = { cidr: '192.168.1.0/24', label: 'Your local network' };

describe('noRoutesWarning', () => {
  it('warns when a VPN has nothing of its own to send', () => {
    const a = vpn('a');
    expect(noRoutesWarning(a, [], compileRoutes({ vpns: [a], routes: [] }))).toBeDefined();
  });

  it('stays quiet when the VPN carries its sites', () => {
    const a = vpn('a');
    const routes = [cidr('r1', 'a', '10.20.0.0/16')];
    expect(
      noRoutesWarning(a, routes, compileRoutes({ vpns: [a], routes, reserved: [LAN] })),
    ).toBeUndefined();
  });

  it('warns when everything it has is kept for the host', () => {
    const a = vpn('a');
    const routes = [cidr('r1', 'a', '192.168.1.0/24')];
    expect(
      noRoutesWarning(a, routes, compileRoutes({ vpns: [a], routes, reserved: [LAN] })),
    ).toBeDefined();
  });

  it('stays quiet when a higher VPN takes its sites: the list explains that', () => {
    const [a, b] = [vpn('a'), vpn('b')];
    const routes = [cidr('r1', 'a', '10.20.0.0/16'), cidr('r2', 'b', '10.20.0.0/16')];
    expect(noRoutesWarning(b, routes, compileRoutes({ vpns: [a, b], routes }))).toBeUndefined();
  });
});

describe('planRoutes', () => {
  const session: VpnSession = {
    port: 41000,
    username: 'u',
    password: 'p',
    pushedDns: [],
    pushedRoutes: undefined,
    endpoint: undefined,
    stop: async () => undefined,
  };
  const plan = (vpns: Config['vpns']) =>
    planRoutes(
      { version: 1, vpns, routes: [cidr('r1', 'a', '10.20.0.0/16')], priority: [] },
      new Map(vpns.map((each) => [each.id, session])),
    );

  it("blocks IPv6 only while a connected VPN carries all traffic, which it can't carry", async () => {
    expect((await plan([vpn('a')]))?.blockIpv6).toBe(false);
    expect((await plan([vpn('a'), { ...vpn('b'), traffic: 'all' }]))?.blockIpv6).toBe(true);
    expect(
      (
        await plan([
          vpn('a'),
          { ...vpn('b'), traffic: 'official', serverRoutes: { all: true, cidrs: [] } },
        ])
      )?.blockIpv6,
    ).toBe(true);
  });
});
