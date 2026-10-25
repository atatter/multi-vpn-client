import { describe, expect, it } from 'vitest';
import { openvpn, OPENVPN_FILE, parseOpenVpnProfile } from './kind.ts';

describe('parseOpenVpnProfile', () => {
  it('extracts remotes and whether a password is needed', () => {
    const profile = `
      client
      dev tun
      # remote commented.example 1194
      remote vpn1.client-b.example 1194 udp
      remote vpn2.client-b.example
      ;remote also-commented.example
      auth-user-pass
      <ca>
      -----BEGIN CERTIFICATE-----
      -----END CERTIFICATE-----
      </ca>
    `;
    expect(parseOpenVpnProfile(profile)).toEqual({
      ok: true,
      remotes: ['vpn1.client-b.example:1194', 'vpn2.client-b.example:1194'],
      needsPassword: true,
    });
  });

  it('rejects a profile without remotes', () => {
    expect(parseOpenVpnProfile('client\ndev tun\n')).toEqual({
      ok: false,
      error: 'The profile has no remote server',
    });
  });
});

describe('an imported profile', () => {
  const draft = openvpn.create({
    id: 'a',
    name: 'Client A',
    dns: { servers: [], domains: [] },
    rememberPassword: false,
    advanced: '',
    traffic: 'official',
    serverRoutes: null,
  });
  const imported = (profile: string) => {
    const read = OPENVPN_FILE.read(profile, draft);
    if (!read.ok) {
      throw new Error(read.error);
    }
    return read.vpn;
  };
  const usernameError = (vpn: ReturnType<typeof imported>) =>
    openvpn.schema.safeParse(vpn).error?.issues.find((issue) => issue.path.join('.') === 'username')
      ?.message;

  it('needs a username when it signs in with a password', () => {
    const vpn = imported('remote vpn.client-a.example\nauth-user-pass\n');
    expect(usernameError(vpn)).toBe('This profile signs in with a username.');
    expect(usernameError({ ...vpn, username: 'jane' })).toBeUndefined();
  });

  it('can be saved without a username when it only uses certificates', () => {
    expect(openvpn.schema.safeParse(imported('remote vpn.client-a.example\n')).success).toBe(true);
  });
});
