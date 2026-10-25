import { isPinnable, Vpn, vpnAddress } from '@repo/core';
import { kindChanges } from './kind-copy.ts';
import { accountName } from './labels.ts';

/** The folded Account line: which account, at which address. */
export function accountSummary(vpn: Vpn): string {
  return [accountName(vpn), vpnAddress(vpn)].filter(Boolean).join(' · ') || 'Not set up yet';
}

/** The folded Advanced line: only what's been changed from the defaults, so nothing customised is hidden. */
export function advancedSummary(vpn: Vpn): string[] {
  const parts: string[] = [];
  if (vpn.dns.domains.length) parts.push(`${vpn.dns.domains.length} DNS ${vpn.dns.domains.length === 1 ? 'domain' : 'domains'}`);
  if (vpn.dns.servers.length) parts.push('own DNS servers');
  if (isPinnable(vpn) && vpn.serverCertPin) parts.push('certificate trusted');
  parts.push(...kindChanges(vpn));
  if (vpn.advanced.trim()) parts.push('extra options');
  return parts;
}
