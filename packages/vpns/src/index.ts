import type { CommonSettings, KindSpec } from '@repo/vpn-sdk';
import { z } from 'zod';
import { checkpoint } from './integrations/checkpoint/kind.ts';
import { fortinetSsl } from './integrations/fortinet-ssl/kind.ts';
import { globalprotect } from './integrations/globalprotect/kind.ts';
import { openvpn } from './integrations/openvpn/kind.ts';

/**
 * Every VPN kind, one folder each in integrations/; code two of them share is in shared/. A kind's `kind.ts`
 * is registered here, its engine side in engine.ts (LAUNCHERS) and its window side in ui.ts (FORMS); each list
 * is keyed by kind, so a new kind doesn't compile until it's in all three. docs/adding-a-vpn-kind.md says what
 * goes in an integration's folder.
 */

/** A saved VPN. In the order the kind picker offers the kinds. */
export const Vpn = z.discriminatedUnion('kind', [openvpn.schema, fortinetSsl.schema, globalprotect.schema, checkpoint.schema]);
export type Vpn = z.infer<typeof Vpn>;
export type VpnKind = Vpn['kind'];
export type VpnOf<K extends VpnKind> = Extract<Vpn, { kind: K }>;

const KINDS: { [K in VpnKind]: KindSpec<VpnOf<K>> } = {
  openvpn,
  'fortinet-ssl': fortinetSsl,
  globalprotect,
  checkpoint,
};

/**
 * A kind's spec, typed for that kind's VPN. Call it with the VPN's own kind (`kindSpec(vpn.kind).hosts(vpn)`):
 * TypeScript can't tie a VPN to its kind's entry by itself, and this keeps that one step without casts.
 */
export const kindSpec = <K extends VpnKind>(kind: K): KindSpec<VpnOf<K>> => KINDS[kind];

export const VPN_KINDS = Vpn.options.map((option) => option.shape.kind.value);

/** Whether an untrusted value (e.g. an IPC argument) names a kind. */
export const isVpnKind = (value: unknown): value is VpnKind => VPN_KINDS.some((kind) => kind === value);

/** Whether the app can learn what this kind's server sends (see KindSpec). */
export const followsServerRoutes = (kind: VpnKind) => KINDS[kind].followsServerRoutes;

/** The server or address a VPN connects to, as typed. */
export const vpnAddress = (vpn: Vpn) => kindSpec(vpn.kind).address(vpn);

/** Hosts this VPN connects to. They must always stay off the tunnel routes. */
export const vpnHosts = (vpn: Vpn) => kindSpec(vpn.kind).hosts(vpn);

/** VPNs whose server certificate can be pinned: kinds with a `serverCertPin` field. */
export type PinnableVpn = Extract<Vpn, { serverCertPin: string }>;
export const isPinnable = (vpn: Vpn): vpn is PinnableVpn => 'serverCertPin' in vpn;

const initialTraffic = (kind: VpnKind, traffic: CommonSettings['traffic']) => (!followsServerRoutes(kind) && traffic === 'official' ? 'sites' : traffic);

export function newVpn<K extends VpnKind>(kind: K, { id, name }: { id: string; name: string }): VpnOf<K> {
  return kindSpec(kind).create({ id, name, dns: { servers: [], domains: [] }, rememberPassword: false, advanced: '', traffic: initialTraffic(kind, 'official'), serverRoutes: null });
}

/** Switches a VPN to another kind, keeping name, DNS, traffic and advanced options. What the old server sent no longer applies. */
export function changeKind<K extends VpnKind>(vpn: Vpn, kind: K): VpnOf<K> {
  const { id, name, dns, rememberPassword, advanced } = vpn;
  return kindSpec(kind).create({ id, name, dns, rememberPassword, advanced, traffic: initialTraffic(kind, vpn.traffic), serverRoutes: null });
}
