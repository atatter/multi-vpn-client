import { describe, expect, it } from 'vitest';
import { needsNoSandbox, versionToStart } from './start.ts';

describe('the version a launcher starts', () => {
  it('downloads its own version when nothing is on disk', () => {
    expect(versionToStart('0.2.0', [])).toEqual({ version: '0.2.0', download: true });
  });

  it("starts its own version when it's already there, without downloading", () => {
    expect(versionToStart('0.2.0', ['0.1.0', '0.2.0'])).toEqual({ version: '0.2.0', download: false });
  });

  it('starts a newer version the app updated itself to, even when the launcher is pinned or cached', () => {
    expect(versionToStart('0.1.0', ['0.1.0', '0.10.0', '0.9.0'])).toEqual({ version: '0.10.0', download: false });
  });

  it('downloads its own version rather than fall back to an older one', () => {
    expect(versionToStart('0.3.0', ['0.2.0'])).toEqual({ version: '0.3.0', download: true });
  });
});

describe("Electron's sandbox", () => {
  it('is only turned off on Linux when AppArmor blocks unprivileged user namespaces', () => {
    expect(needsNoSandbox('linux', '1\n')).toBe(true);
    expect(needsNoSandbox('linux', '0\n')).toBe(false);
    expect(needsNoSandbox('linux', undefined)).toBe(false);
    expect(needsNoSandbox('darwin', '1')).toBe(false);
  });
});
