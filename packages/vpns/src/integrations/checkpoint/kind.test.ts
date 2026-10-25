import { describe, expect, it } from 'vitest';
import { canUseLoginType } from './kind.ts';

describe('canUseLoginType', () => {
  const type = (...factors: string[]) => ({ id: 'vpn_x', label: 'X', factors });

  it('accepts password logins with codes, and browser sign-in (Microsoft Entra ID)', () => {
    expect(canUseLoginType(type('password'))).toBe(true);
    expect(canUseLoginType(type('password', 'sms'))).toBe(true);
    expect(canUseLoginType(type('identity_provider'))).toBe(true);
  });

  it('turns away logins that need a certificate or Mobile Access', () => {
    expect(canUseLoginType(type('certificate', 'username_only'))).toBe(false);
    expect(canUseLoginType(type('mobile_access'))).toBe(false);
  });
});
