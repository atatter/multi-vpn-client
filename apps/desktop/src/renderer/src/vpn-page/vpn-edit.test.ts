import { newRoute, newVpn, type Config, type RouteRule } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { changedFields, configAfterRemove, configAfterSave, isDirty, savingReconnects, siteWarnings } from './vpn-edit.ts';

const gp = { ...newVpn('globalprotect', { id: 'a', name: 'Client A' }), portal: 'vpn.client-a.example', username: 'jane' };
const sites = (id: string, name: string) => ({ ...newVpn('fortinet-ssl', { id, name }), traffic: 'sites' as const, gateway: `${id}.example.com` });
const route = (vpnId: string, cidr: string): RouteRule => ({ ...newRoute(cidr, vpnId), id: `${vpnId}-${cidr}` });
const config = (vpns: Config['vpns'], routes: RouteRule[] = [], priority: string[] = []): Config => ({ version: 1, vpns, routes, priority });

describe('what the user changed', () => {
  it('holds only the fields that differ from the saved VPN', () => {
    expect(changedFields(gp, { ...gp, name: 'Client A (work)' })).toEqual({ name: 'Client A (work)' });
    expect(changedFields(gp, { ...gp })).toEqual({});
  });

  it('is dirty with changed fields, edited sites or typed secrets, and clean otherwise', () => {
    expect(isDirty(gp, gp, undefined, {})).toBe(false);
    expect(isDirty(gp, { ...gp, name: 'Other' }, undefined, {})).toBe(true);
    expect(isDirty(gp, gp, [], {})).toBe(true);
    expect(isDirty(gp, gp, undefined, { password: 'hunter2' })).toBe(true);
  });
});

describe('whether saving reconnects', () => {
  it("doesn't reconnect for a new name, traffic choice or remembered password", () => {
    expect(savingReconnects(gp, { ...gp, name: 'Other', traffic: 'all', rememberPassword: true }, { password: 'hunter2' }, true)).toBe(false);
  });

  it('reconnects a connected VPN whose connection settings or profile change', () => {
    expect(savingReconnects(gp, { ...gp, portal: 'vpn2.client-a.example' }, {}, true)).toBe(true);
    expect(savingReconnects(gp, gp, { profile: 'client\nremote x' }, true)).toBe(true);
  });

  it("never reconnects a VPN that isn't connected", () => {
    expect(savingReconnects(gp, { ...gp, portal: 'vpn2.client-a.example' }, {}, false)).toBe(false);
  });
});

describe('the config after saving or removing', () => {
  it('replaces the VPN and only its own sites', () => {
    const b = sites('b', 'Client B');
    const before = config([gp, b], [route('a', '10.1.0.0/16'), route('b', '10.2.0.0/16')]);
    const after = configAfterSave(before, b, { ...b, name: 'B' }, [route('b', '10.3.0.0/16')]);
    expect(after.vpns.map((vpn) => vpn.name)).toEqual(['Client A', 'B']);
    expect(after.routes.map((rule) => rule.id)).toEqual(['a-10.1.0.0/16', 'b-10.3.0.0/16']);
    expect(after.priority).toEqual([]);
  });

  it('moves a VPN switched to all traffic to where all-traffic VPNs start', () => {
    const b = sites('b', 'Client B');
    const before = config([gp, b], [], ['b', 'a']);
    expect(configAfterSave(before, b, { ...b, traffic: 'all' }, []).priority).not.toEqual(['b', 'a']);
  });

  it('removes the VPN and its sites', () => {
    const b = sites('b', 'Client B');
    const after = configAfterRemove(config([gp, b], [route('a', '10.1.0.0/16'), route('b', '10.2.0.0/16')]), 'b');
    expect(after.vpns.map((vpn) => vpn.id)).toEqual(['a']);
    expect(after.routes.map((rule) => rule.vpnId)).toEqual(['a']);
  });
});

describe('site warnings', () => {
  it("names the higher VPN that wins one of the edited VPN's sites", () => {
    const a = sites('a', 'Client A');
    const b = sites('b', 'Client B');
    const own = route('b', '10.140.1.0/24');
    const warnings = siteWarnings(config([a, b], [route('a', '10.140.0.0/16')], ['a', 'b']), b, [own]);
    expect(warnings.get(own.id)).toEqual({ winner: 'Client A' });
  });

  it("doesn't warn about a pinned site: it wins whatever the order", () => {
    const a = sites('a', 'Client A');
    const b = sites('b', 'Client B');
    const own = { ...route('b', '10.140.1.0/24'), pinned: true };
    expect(siteWarnings(config([a, b], [route('a', '10.140.0.0/16')], ['a', 'b']), b, [own]).size).toBe(0);
  });
});
