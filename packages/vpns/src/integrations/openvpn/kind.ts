import {
  bareHosts,
  commonFields,
  defineKind,
  type FromFile,
  HostPort,
  PASSWORD_SLOT,
} from '@repo/vpn-sdk';
import { z } from 'zod';

export type OpenVpnImport =
  | { ok: true; remotes: string[]; needsPassword: boolean }
  | { ok: false; error: string };

/** Reads what we need from an .ovpn profile. The profile itself is kept whole, as a secret. */
export function parseOpenVpnProfile(text: string): OpenVpnImport {
  const remotes: string[] = [];
  let needsPassword = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('#') || line.startsWith(';')) continue;
    const remote = /^remote\s+(\S+)(?:\s+(\d+))?/.exec(line);
    if (remote?.[1]) remotes.push(`${remote[1]}:${remote[2] ?? '1194'}`);
    if (/^auth-user-pass\b/.test(line)) needsPassword = true;
  }
  if (remotes.length === 0) return { ok: false, error: 'The profile has no remote server' };
  return { ok: true, remotes, needsPassword };
}

const schema = z
  .object({
    ...commonFields,
    kind: z.literal('openvpn'),
    /** Extracted from the imported profile, which itself is stored as a secret. */
    remotes: z.array(HostPort).min(1, 'Import an .ovpn profile'),
    username: z.string(),
    /** The imported profile has `auth-user-pass`: it signs in with a username and password. */
    needsPassword: z.boolean().default(false),
  })
  .refine((vpn) => !vpn.needsPassword || vpn.username !== '', {
    path: ['username'],
    message: 'This profile signs in with a username.',
  });

/** A saved OpenVPN VPN. */
export type OpenVpn = z.output<typeof schema>;

/** The provider's profile, however it's chosen: kept whole, as a secret; only its servers become settings. */
export const OPENVPN_FILE: FromFile<OpenVpn> = {
  extensions: ['.ovpn', '.conf'],
  read: (text, draft) => {
    const parsed = parseOpenVpnProfile(text);
    return parsed.ok
      ? {
          ok: true,
          vpn: { ...draft, remotes: parsed.remotes, needsPassword: parsed.needsPassword },
          secrets: { profile: text },
        }
      : parsed;
  },
};

/** OpenVPN, from the .ovpn profile the provider hands out. The profile itself is a secret. */
export const openvpn = defineKind(schema, {
  create: (c) => ({ ...c, kind: 'openvpn', remotes: [], username: '', needsPassword: false }),
  address: (vpn) => vpn.remotes[0] ?? '',
  withAddress: (vpn, address) => ({ ...vpn, remotes: [address, ...vpn.remotes.slice(1)] }),
  // Every remote: OpenVPN may fall back to any of them.
  hosts: (vpn) => bareHosts(vpn.remotes),
  secrets: [
    {
      key: 'profile',
      label: '.ovpn profile',
      storage: 'always',
      required: true,
      importOnly: true,
      fills: ['remotes'],
      schema: z.string().min(1),
    },
    PASSWORD_SLOT,
  ],
  fromFile: OPENVPN_FILE,
  followsServerRoutes: true,
});
