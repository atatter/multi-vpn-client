import { Vpn } from '@repo/core';

/** "acme-corp.ovpn" → "Acme Corp", "client-z" → "Client Z". */
export const nameFromFile = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** A name from the address people type: the most telling label, e.g. "vpn.client-a.example" → "Client A". */
export function nameFromAddress(address: string): string {
  const labels = address.replace(/:\d+$/, '').toLowerCase().split('.').filter(Boolean);
  const generic = new Set([
    'vpn',
    'sslvpn',
    'remote',
    'gp',
    'portal',
    'sso',
    'access',
    'connect',
    'www',
    'secure',
    'ra',
    'gw',
    'gateway',
  ]);
  const label = labels.slice(0, -1).find((part) => !generic.has(part)) ?? labels[0] ?? 'VPN';
  return nameFromFile(label);
}

/** A name not used yet: "Client A", "Client A 2", … */
export function uniqueName(name: string, vpns: readonly Vpn[]): string {
  if (!vpns.some((vpn) => vpn.name === name)) return name;
  for (let n = 2; ; n++)
    if (!vpns.some((vpn) => vpn.name === `${name} ${n}`)) return `${name} ${n}`;
}
