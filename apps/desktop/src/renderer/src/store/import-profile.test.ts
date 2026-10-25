import { describe, expect, it } from 'vitest';
import { importProfile } from './import-profile.ts';

const OVPN = 'client\ndev tun\nremote vpn.client-b.example 1194\n';

describe('importProfile', () => {
  it('makes an OpenVPN draft from a profile, keeping the profile as its secret', async () => {
    const result = await importProfile(new File([OVPN], 'Client B.ovpn'), []);
    expect(result.ok && result.screen.draft).toMatchObject({ kind: 'openvpn', name: 'Client B', remotes: ['vpn.client-b.example:1194'] });
    expect(result.ok && result.screen.secrets).toEqual({ profile: OVPN });
  });

  it("says why a broken profile or an unknown file can't be used", async () => {
    expect(await importProfile(new File(['client\n'], 'broken.ovpn'), [])).toEqual({ ok: false, error: "broken.ovpn isn't a valid OpenVPN file: The profile has no remote server" });
    expect(await importProfile(new File(['x'], 'notes.txt'), [])).toEqual({ ok: false, error: "notes.txt isn't a VPN file this app reads. It takes OpenVPN (.ovpn) files." });
  });
});
