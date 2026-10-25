import { newVpn } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { usesPassword } from './connection.ts';

describe('usesPassword', () => {
  const vpn = { id: 'v', name: 'V' };

  it('is the login password unless the VPN signs in another way', () => {
    expect(usesPassword(newVpn('globalprotect', vpn))).toBe(true);
    expect(usesPassword({ ...newVpn('globalprotect', vpn), signIn: 'card' })).toBe(false);
  });
});
