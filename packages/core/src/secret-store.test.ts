import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newVpn, type Vpn } from '@repo/vpns';
import { createSecretStore, type Cipher } from './secret-store.ts';
import type { SecretChanges } from './secrets.ts';

// Reversible but visibly not plaintext, so tests can assert nothing leaks to disk.
const fakeCipher: Cipher = {
  encrypt: async (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decrypt: async (data) => Array.from(data.toString().slice(4)).reverse().join(''),
};
const noKeychain: Cipher = {
  ...fakeCipher,
  encrypt: async () => {
    throw new Error('No secret service is running.');
  },
};

const PROFILE = 'client\nremote vpn.example 1194\n';
const openvpn = newVpn('openvpn', { id: 'o', name: 'O' });
const gp = { ...newVpn('globalprotect', { id: 'g', name: 'G' }), rememberPassword: true };

const tempStore = async (cipher = fakeCipher) => {
  const path = join(await mkdtemp(join(tmpdir(), 'mvpn-secrets-')), 'secrets.json');
  const store = createSecretStore(path, cipher);
  const apply = async (changes: SecretChanges, vpns: Vpn[]) =>
    (await store.prepare(changes, vpns)).commit();
  return { path, store, apply };
};

describe('secret store', () => {
  it('starts empty', async () => {
    const { store } = await tempStore();
    expect(await store.status()).toEqual({});
  });

  it('stores encrypted values and reports only which slots are set', async () => {
    const { path, store, apply } = await tempStore();
    const status = await apply({ o: { profile: PROFILE }, g: { password: 'hunter2' } }, [
      openvpn,
      gp,
    ]);

    expect(status).toEqual({ o: ['profile'], g: ['password'] });
    const onDisk = await readFile(path, 'utf8');
    expect(onDisk).not.toContain(PROFILE);
    expect(onDisk).not.toContain('hunter2');
    expect(JSON.parse(onDisk).vpns.g.password).toBe(Buffer.from('enc:2retnuh').toString('base64'));
    expect(await store.read('g', 'password')).toBe('hunter2');
    expect(await store.read('g', 'missing')).toBeUndefined();
    // Windows has no file modes to check.
    if (process.platform !== 'win32') {
      // oxlint-disable-next-line vitest/no-conditional-expect
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it('clears slots and prunes against the current VPNs', async () => {
    const { apply } = await tempStore();
    await apply({ o: { profile: PROFILE }, g: { password: 'hunter2' } }, [openvpn, gp]);

    expect(await apply({ o: { profile: null } }, [openvpn, gp])).toEqual({ g: ['password'] });
    // Turning "remember password" off drops the stored password on the next save.
    expect(await apply({}, [openvpn, { ...gp, rememberPassword: false }])).toEqual({});
  });

  it('refuses invalid changes before writing anything', async () => {
    const { store, apply } = await tempStore();
    await apply({ g: { password: 'hunter2' } }, [openvpn, gp]);
    await expect(store.prepare({ o: { profile: '' } }, [openvpn, gp])).rejects.toThrow(
      '.ovpn profile',
    );
    expect(await store.status()).toEqual({ g: ['password'] });
  });

  it('writes nothing when the cipher refuses (no keychain)', async () => {
    const { path, store } = await tempStore(noKeychain);
    await expect(store.prepare({ g: { password: 'hunter2' } }, [openvpn, gp])).rejects.toThrow(
      'No secret service',
    );
    await expect(stat(path)).rejects.toThrow(/ENOENT/);
  });

  it('treats a value the key can no longer decrypt as missing', async () => {
    const { path, apply } = await tempStore();
    await apply({ g: { password: 'hunter2' } }, [gp]);
    const otherKey = createSecretStore(path, {
      ...fakeCipher,
      decrypt: async () => Promise.reject(new Error('Error while decrypting the ciphertext')),
    });
    expect(await otherKey.read('g', 'password')).toBeUndefined();
    expect(await otherKey.status()).toEqual({});
  });
});
