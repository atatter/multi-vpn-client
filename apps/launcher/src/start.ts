import { compareVersions } from '@repo/release';
import { readFileSync } from 'node:fs';

/**
 * Which version to start: the newest one on disk, unless this launcher's own is newer, which then needs downloading.
 * Never an older one: the app may have updated itself past this launcher, which can be pinned, cached by npx or offline.
 */
export function versionToStart(own: string, installed: string[]) {
  const newest = installed.reduce<string | undefined>(
    (best, version) => (!best || compareVersions(version, best) > 0 ? version : best),
    undefined,
  );
  return newest && compareVersions(newest, own) >= 0
    ? { version: newest, download: false }
    : { version: own, download: true };
}

/** Reads a small system file, or undefined where it doesn't exist. */
export function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Electron's sandbox needs unprivileged user namespaces or a setuid-root chrome-sandbox. Ubuntu 23.10+ blocks the
 * first with AppArmor, and an unpacked archive can't have the second, so there the window runs without Chromium's
 * sandbox. It's still context-isolated and only ever loads the app's own files.
 */
export const needsNoSandbox = (platform: NodeJS.Platform, restrictUserns: string | undefined) =>
  platform === 'linux' && restrictUserns?.trim() === '1';
