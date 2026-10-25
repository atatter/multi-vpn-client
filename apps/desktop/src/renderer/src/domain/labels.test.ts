import { newVpn } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { accountName } from './labels.ts';

describe('accountName', () => {
  const gp = { ...newVpn('globalprotect', { id: 'v', name: 'V' }), username: 'jane' };

  it('names the card a VPN signs in with, else its username', () => {
    expect(accountName(gp)).toBe('jane');
    expect(accountName({ ...gp, signIn: 'card' })).toBe('ID card');
    expect(accountName({ ...gp, signIn: 'card', cardCertificate: 'pkcs11:id=%02;type=cert' })).toBe('Smart card');
  });
});
