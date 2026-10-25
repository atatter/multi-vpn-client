import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  archiveUrl,
  compareVersions,
  executableIn,
  isVersion,
  Manifest,
  versionsDir,
} from './release.ts';

const manifest: Manifest = {
  version: '1.2.3',
  archives: {
    'linux-x64': {
      file: 'multi-vpn-client-1.2.3-linux-x64.tar.gz',
      sha256: 'a'.repeat(64),
      size: 180_000_000,
    },
  },
};
const archive = manifest.archives['linux-x64']!;

describe('the release manifest', () => {
  it('only accepts plain file names and full SHA-256 checksums', () => {
    expect(Manifest.safeParse(manifest).success).toBe(true);
    expect(
      Manifest.safeParse({
        ...manifest,
        archives: { 'linux-x64': { ...archive, file: '../evil' } },
      }).success,
    ).toBe(false);
    expect(
      Manifest.safeParse({ ...manifest, archives: { 'linux-x64': { ...archive, sha256: 'abc' } } })
        .success,
    ).toBe(false);
    expect(Manifest.safeParse({ ...manifest, version: 'latest' }).success).toBe(false);
  });

  it("needs each archive's size in bytes", () => {
    expect(
      Manifest.safeParse({ ...manifest, archives: { 'linux-x64': { ...archive, size: -1 } } })
        .success,
    ).toBe(false);
    expect(
      Manifest.safeParse({
        ...manifest,
        archives: { 'linux-x64': { file: archive.file, sha256: archive.sha256 } },
      }).success,
    ).toBe(false);
  });

  it("downloads from the version's GitHub Release, or from MVPN_RELEASE_URL when set", () => {
    expect(archiveUrl(manifest, archive, {})).toBe(
      'https://github.com/atatter/multi-vpn-client/releases/download/v1.2.3/multi-vpn-client-1.2.3-linux-x64.tar.gz',
    );
    expect(archiveUrl(manifest, archive, { MVPN_RELEASE_URL: 'http://127.0.0.1:8000' })).toBe(
      'http://127.0.0.1:8000/multi-vpn-client-1.2.3-linux-x64.tar.gz',
    );
  });
});

describe('where versions are unpacked', () => {
  it("uses each OS's per-user cache", () => {
    expect(versionsDir({ LOCALAPPDATA: join('/', 'local') }, 'win32', '/home/a')).toBe(
      join('/', 'local', 'Multi VPN Client', 'versions'),
    );
    expect(versionsDir({}, 'darwin', '/Users/a')).toBe(
      join('/Users/a', 'Library', 'Caches', 'Multi VPN Client', 'versions'),
    );
    expect(versionsDir({ XDG_CACHE_HOME: join('/', 'cache') }, 'linux', '/home/a')).toBe(
      join('/', 'cache', 'multi-vpn-client', 'versions'),
    );
  });

  it('ignores empty or relative cache variables instead of resolving them against the current folder', () => {
    expect(versionsDir({ XDG_CACHE_HOME: 'relative' }, 'linux', '/home/a')).toBe(
      join('/home/a', '.cache', 'multi-vpn-client', 'versions'),
    );
    expect(versionsDir({ LOCALAPPDATA: '' }, 'win32', '/home/a')).toBe(
      join('/home/a', 'AppData', 'Local', 'Multi VPN Client', 'versions'),
    );
  });

  it("finds the executable each OS's archive has", () => {
    expect(executableIn('v', 'darwin')).toBe(
      join('v', 'Multi VPN Client.app', 'Contents', 'MacOS', 'Multi VPN Client'),
    );
    expect(executableIn('v', 'win32')).toBe(join('v', 'Multi VPN Client.exe'));
    expect(executableIn('v', 'linux')).toBe(join('v', 'multi-vpn-client'));
  });
});

describe('versions', () => {
  it('compare by number, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '2.0.0')).toBeLessThan(0);
  });

  it("are only plain x.y.z names, so temporary folders aren't mistaken for one", () => {
    expect(isVersion('0.2.0')).toBe(true);
    expect(isVersion('.download-abc')).toBe(false);
    expect(isVersion('0.2.0-beta')).toBe(false);
  });
});
