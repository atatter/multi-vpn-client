import { describe, expect, it } from 'vitest';
import { CHECKPOINT_IMAGE } from './integrations/checkpoint/container.ts';
import { OPENCONNECT_CARD_IMAGE, OPENCONNECT_IMAGE } from './shared/openconnect/container.ts';
import { OPENVPN_IMAGE } from './integrations/openvpn/container.ts';

describe('VPN client images', () => {
  it('are content-addressed, one per client', () => {
    expect(OPENVPN_IMAGE.tag).toMatch(/^mvpn-openvpn:[0-9a-f]{12}$/);
    expect(OPENCONNECT_IMAGE.tag).toMatch(/^mvpn-openconnect:[0-9a-f]{12}$/);
    expect(OPENCONNECT_CARD_IMAGE.tag).toMatch(/^mvpn-smartcard:[0-9a-f]{12}$/);
    expect(CHECKPOINT_IMAGE.tag).toMatch(/^mvpn-checkpoint:[0-9a-f]{12}$/);
  });

  it("carry only their own client's start script", () => {
    expect(OPENVPN_IMAGE.dockerfile).toContain('mvpn-start-openvpn');
    expect(OPENVPN_IMAGE.dockerfile).not.toContain('openconnect');
    expect(OPENCONNECT_IMAGE.dockerfile).toContain('mvpn-start-openconnect');
    expect(OPENCONNECT_IMAGE.dockerfile).not.toContain('openvpn');
  });
});
