import { describe, expect, it } from 'vitest';
import { changeKind, kindSpec, newVpn } from '@repo/vpns';
import { applySecretChanges, changesForSave, kindChangeClears, missingSecrets, pruneSecrets, validateSecretChanges } from './secrets.ts';

const openvpn = newVpn('openvpn', { id: 'o', name: 'O' });
const gp = { ...newVpn('globalprotect', { id: 'g', name: 'G' }), rememberPassword: true };

describe('secret slots', () => {
  it('describes what each kind needs', () => {
    expect(kindSpec('openvpn').secrets.map((slot) => [slot.key, slot.storage])).toEqual([
      ['profile', 'always'],
      ['password', 'remember'],
    ]);
  });
});

describe('pruneSecrets', () => {
  it("drops secrets of deleted VPNs, foreign slots, and passwords that shouldn't be remembered", () => {
    const stored = {
      o: { profile: 'p', psk: 'not an OpenVPN slot' },
      g: { password: 'p' },
      gone: { password: 'p' },
    };
    expect(pruneSecrets(stored, [openvpn, gp])).toEqual({ o: { profile: 'p' }, g: { password: 'p' } });
    expect(pruneSecrets(stored, [openvpn, { ...gp, rememberPassword: false }])).toEqual({ o: { profile: 'p' } });
  });
});

describe('missingSecrets', () => {
  it("lists required slots that aren't stored", () => {
    expect(missingSecrets(openvpn, []).map((slot) => slot.key)).toEqual(['profile']);
    expect(missingSecrets(openvpn, ['profile'])).toEqual([]);
    expect(missingSecrets(gp, [])).toEqual([]);
  });
});

describe('validateSecretChanges', () => {
  it('accepts valid values and clears', () => {
    expect(validateSecretChanges({ o: { profile: 'client', password: null }, g: { password: 'hunter2' } }, [openvpn, gp])).toEqual([]);
  });

  it("accepts clearing any slot, so a kind change can drop the old kind's secrets", () => {
    const switched = changeKind({ ...newVpn('openvpn', { id: 'o', name: 'O' }), rememberPassword: true }, 'checkpoint');
    expect(validateSecretChanges({ o: { profile: null, password: null } }, [switched])).toEqual([]);
  });

  it('rejects unknown VPNs, foreign slots and malformed values', () => {
    expect(
      validateSecretChanges({ o: { profile: '', psk: 'x' }, ghost: { password: 'x' } }, [openvpn, gp]),
    ).toEqual([
      'O: .ovpn profile: Too small: expected string to have >=1 characters',
      'O: "psk" is not a secret of this VPN type',
      'Unknown VPN "ghost"',
    ]);
  });
});

describe('kindChangeClears', () => {
  it('clears every stored slot of a VPN whose kind changed, and nothing else', () => {
    const fortinet = { ...newVpn('fortinet-ssl', { id: 'f', name: 'F' }), rememberPassword: true };
    const switched = changeKind(fortinet, 'checkpoint');
    expect(kindChangeClears([fortinet, gp], [switched, gp])).toEqual({ f: { password: null } });
  });
});

describe('changesForSave', () => {
  it('clears the old secrets of a VPN whose kind changed, unless the user typed a new value', () => {
    const fortinet = { ...newVpn('fortinet-ssl', { id: 'f', name: 'F' }), rememberPassword: true };
    const switched = changeKind(fortinet, 'openvpn');
    expect(changesForSave([fortinet], [switched], {})).toEqual({ f: { password: null } });
    expect(changesForSave([fortinet], [switched], { f: { password: 'new', profile: 'k' } })).toEqual({ f: { password: 'new', profile: 'k' } });
  });
});

describe('applySecretChanges', () => {
  it("sets and clears slots, then drops what the VPNs don't keep", () => {
    const stored = { g: { password: 'old' }, gone: { password: 'x' } };
    expect(applySecretChanges(stored, { g: { password: 'new' } }, [gp])).toEqual({ g: { password: 'new' } });
    expect(applySecretChanges(stored, { g: { password: null } }, [gp])).toEqual({});
    expect(stored.g.password).toBe('old');
  });
});
