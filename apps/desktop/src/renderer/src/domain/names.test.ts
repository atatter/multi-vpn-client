import { newVpn } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { nameFromAddress, nameFromFile, uniqueName } from './names.ts';

describe('names', () => {
  it('takes the most telling label of an address', () => {
    expect(nameFromAddress('vpn.client-a.example')).toBe('Client A');
    expect(nameFromAddress('sslvpn.acme.example:10443')).toBe('Acme');
  });

  it('turns a file name into words', () => {
    expect(nameFromFile('acme-corp.ovpn')).toBe('Acme Corp');
  });

  it("numbers a name that's taken", () => {
    const vpns = [newVpn('openvpn', { id: '1', name: 'Client A' }), newVpn('openvpn', { id: '2', name: 'Client A 2' })];
    expect(uniqueName('Client A', vpns)).toBe('Client A 3');
    expect(uniqueName('Client B', vpns)).toBe('Client B');
  });
});
