import { createDocker } from '@repo/engine/uninstall';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatBytes, heldLock, keepQuestion, npxEntry, singletonLockHeld, uninstallSteps, type Found } from './uninstall.ts';

const everything: Found = {
  platform: 'darwin',
  helper: true,
  desktopEntry: [],
  cache: { dir: '/cache/Multi VPN Client', versions: 2, bytes: 360e6 },
  docker: { docker: createDocker('docker'), images: [{ ref: 'mvpn-openvpn:abc', bytes: 600e6 }, { ref: 'mvpn-checkpoint:def', bytes: 500e6 }] },
  appFolder: '/data/Multi VPN Client',
  data: { vpns: 4, others: ['bin', 'Cache', 'helper.json'] },
  keychainKey: true,
};
const whats = (found: Found, deleteVpns: boolean) => uninstallSteps(found, deleteVpns).map((step) => step.what);
const keychainKey = 'the key that encrypted your saved passwords ("Multi VPN Client Safe Storage")';

describe('uninstallSteps', () => {
  it('removes the helper first, and only what can be downloaded again unless asked', () => {
    expect(whats(everything, false)).toEqual([
      'the network helper (asks for your password)',
      '2 downloaded versions, 360 MB',
      '2 VPN container images, up to 1.1 GB',
      "sing-box and the app's caches",
    ]);
  });

  it('deletes the VPNs, their passwords and the keychain key when asked', () => {
    expect(whats(everything, true).slice(3)).toEqual(['your VPNs and their saved passwords', keychainKey]);
  });

  it("removes the app's folder without asking when it holds no VPNs", () => {
    const found: Found = { ...everything, data: { vpns: 0, others: [] }, keychainKey: false };
    expect(keepQuestion(found)).toBeUndefined();
    expect(whats(found, false).at(-1)).toBe("the app's settings");
  });

  it("says up front that the images stay while Docker isn't running, and how to remove them", () => {
    const [step] = uninstallSteps({ ...everything, helper: false, cache: undefined, docker: { problem: "Docker isn't reachable." } }, false);
    expect(step).toMatchObject({ what: 'any VPN container images', reason: "Docker isn't reachable.", manual: expect.stringContaining('Start Docker') });
  });

  it('removes the Linux desktop entry after the versions it starts', () => {
    const entry = ['/home/ann/.local/share/applications/dev.multi-vpn-client.desktop', '/home/ann/.local/share/icons/hicolor/512x512/apps/dev.multi-vpn-client.png'];
    expect(whats({ ...everything, platform: 'linux', desktopEntry: entry }, false).slice(1, 3)).toEqual(['2 downloaded versions, 360 MB', "the app's entry in your app list"]);
  });

  it("only removes what's there", () => {
    expect(whats({ ...everything, helper: false, cache: undefined, docker: undefined, data: undefined, keychainKey: false }, true)).toEqual([]);
    expect(whats({ ...everything, docker: { docker: createDocker('docker'), images: [] } }, false)).not.toContain(expect.stringContaining('image'));
    expect(whats({ ...everything, data: { vpns: 4, others: [] } }, false)).not.toContain("sing-box and the app's caches");
  });

  it('removes a keychain key whose app folder is already gone', () => {
    expect(whats({ ...everything, data: undefined }, false).at(-1)).toBe(keychainKey);
  });

  it("can't remove the Linux keyring's key for the user, so it says how", () => {
    expect(uninstallSteps({ ...everything, platform: 'linux' }, true).at(-1)).toMatchObject({
      reason: expect.stringContaining('depends on your desktop'),
      manual: expect.stringContaining('Multi VPN Client Safe Storage'),
    });
  });
});

describe('keepQuestion', () => {
  it("counts the VPNs, or says 'your VPNs' when the config can't be read", () => {
    expect(keepQuestion(everything)).toBe('Also delete your 4 VPNs and their saved passwords?');
    expect(keepQuestion({ ...everything, data: { vpns: 1, others: [] } })).toBe('Also delete your VPN and its saved passwords?');
    expect(keepQuestion({ ...everything, data: { vpns: undefined, others: [] } })).toBe('Also delete your VPNs and their saved passwords?');
  });
});

describe('singletonLockHeld', () => {
  const alive = (pid: number) => pid === 42;
  it("reads Chromium's <host>-<pid> lock, where host names may contain dashes", () => {
    expect(singletonLockHeld('my-mac.local-42', 'my-mac.local', alive)).toBe(true);
    expect(singletonLockHeld('my-mac.local-43', 'my-mac.local', alive)).toBe(false);
  });
  it("treats another machine's lock as held, and a broken one as not", () => {
    expect(singletonLockHeld('other-host-43', 'my-mac.local', alive)).toBe(true);
    expect(singletonLockHeld('garbage', 'my-mac.local', alive)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('heldLock', () => {
  it('names the lock a live process on this machine holds, so a stale one can be deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mvpn-uninstall-'));
    try {
      expect(heldLock(dir, process.platform)).toBeUndefined();
      await symlink(`${hostname()}-${process.pid}`, join(dir, 'SingletonLock'));
      expect(heldLock(dir, process.platform)).toBe(join(dir, 'SingletonLock'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('formatBytes', () => {
  it('uses decimal units, as Docker does', () => {
    expect([formatBytes(1000), formatBytes(360e6), formatBytes(1.14e9)]).toEqual(['1 MB', '360 MB', '1.1 GB']);
  });
});

describe('npxEntry', () => {
  it('finds the npx cache entry the launcher runs from, on every OS', () => {
    expect(npxEntry('/home/a/.npm/_npx/0123abcd/node_modules/multi-vpn-client/bin.mjs')).toBe('/home/a/.npm/_npx/0123abcd');
    expect(npxEntry('C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\0123abcd\\node_modules\\multi-vpn-client\\bin.mjs')).toBe(
      'C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\0123abcd',
    );
    expect(npxEntry('/usr/local/lib/node_modules/multi-vpn-client/bin.mjs')).toBeUndefined();
  });
});
