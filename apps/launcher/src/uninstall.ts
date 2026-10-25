import { APP_NAME } from '@repo/core';
import { appDir, desktopEntryFiles } from '@repo/core/store';
import {
  createDocker,
  findDocker,
  helperInstalled,
  listVpnImages,
  removeStaleContainers,
  uninstallHelper,
  type Docker,
} from '@repo/engine/uninstall';
import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readlinkSync } from 'node:fs';
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { versionsDir } from '@repo/release';

/** The macOS Keychain item where Electron keeps the key that encrypts saved passwords, named after the app. */
const KEYCHAIN_SERVICE = `${APP_NAME} Safe Storage`;
const keychain = (command: 'find-generic-password' | 'delete-generic-password') =>
  promisify(execFile)('/usr/bin/security', [command, '-s', KEYCHAIN_SERVICE]);

/** What `uninstall` found on this machine. */
export interface Found {
  platform: NodeJS.Platform;
  helper: boolean;
  /** The Linux desktop entry and its icon that put the app in the app grid and let the dock badge it. */
  desktopEntry: string[];
  /** The launcher's cache folder: unpacked versions, and the source triage clones. */
  cache: { dir: string; versions: number; bytes: number } | undefined;
  /** VPN container images, or why Docker couldn't list them. Undefined when Docker isn't installed. */
  docker:
    | { docker: Docker; images: Awaited<ReturnType<typeof listVpnImages>> }
    | { problem: string }
    | undefined;
  /** The app's folder: VPNs, saved passwords, the helper's token, sing-box and Electron's own data. */
  appFolder: string;
  /**
   * What's in the app's folder, if it exists: how many VPNs (undefined when its config can't be read), and the
   * entries that go even when the VPNs stay.
   */
  data: { vpns: number | undefined; others: string[] } | undefined;
  /** Whether the OS keychain may hold the key that encrypts saved passwords outside the app's folder. */
  keychainKey: boolean;
}

/**
 * One thing uninstall removes, or, with a `reason` instead of `run`, one it can't and the user has to. `what` is shown
 * before anything is removed, and `manual` says how to remove it by hand when it's left behind.
 */
export type Step = { what: string; manual: string } & (
  | { run: () => Promise<void> }
  | { reason: string }
);

/**
 * What keeps the VPNs and their saved passwords usable when they stay: the config, the encrypted secrets, and
 * Electron's Local State, which holds the key that encrypts them on Windows.
 */
const KEPT_WITH_VPNS = new Set(['config.json', 'secrets.json', 'Local State']);

/**
 * The single-instance lock the running app holds in its folder, or undefined when it isn't running. On macOS and Linux
 * that's Chromium's SingletonLock symlink to "<host>-<pid>"; on Windows a lockfile the app keeps open for writing.
 */
export function heldLock(appFolder: string, platform: NodeJS.Platform): string | undefined {
  if (platform === 'win32') {
    const lockfile = join(appFolder, 'lockfile');

    try {
      closeSync(openSync(lockfile, 'r+'));
      return undefined;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      return code === 'EBUSY' || code === 'EPERM' ? lockfile : undefined;
    }
  }

  const lock = join(appFolder, 'SingletonLock');
  let target: string;

  try {
    target = readlinkSync(lock);
  } catch {
    return undefined;
  }

  const held = singletonLockHeld(target, hostname(), (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  });

  return held ? lock : undefined;
}

/** A lock from another machine (a shared home folder) counts as held: there's no telling whether that app is still running. */
export function singletonLockHeld(
  target: string,
  host: string,
  alive: (pid: number) => boolean,
): boolean {
  const split = target.lastIndexOf('-');
  const pid = Number(target.slice(split + 1));
  if (split <= 0 || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  return target.slice(0, split) !== host || alive(pid);
}

/** Looks for everything the app and this launcher put on the machine. Finding never changes anything. */
export async function survey(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): Promise<Found> {
  const versions = versionsDir(env, platform, home);
  const cacheDir = dirname(versions);
  const appFolder = appDir(env, platform);
  const data = existsSync(appFolder)
    ? {
        vpns: await countVpns(join(appFolder, 'config.json')),
        others: (await readdir(appFolder)).filter((entry) => !KEPT_WITH_VPNS.has(entry)),
      }
    : undefined;

  return {
    platform,
    helper: helperInstalled(),
    desktopEntry: Object.values(desktopEntryFiles(env, home)).filter((path) => existsSync(path)),
    cache: existsSync(cacheDir)
      ? {
          dir: cacheDir,
          versions: (await readdir(versions).catch(() => [])).filter(
            (entry) => !entry.startsWith('.'),
          ).length,
          bytes: await folderBytes(cacheDir),
        }
      : undefined,
    docker: await dockerImages(),
    appFolder,
    data,
    // Linux has no one place to look (see keychainStep); a key with no VPNs behind it encrypted nothing.
    keychainKey:
      platform === 'darwin'
        ? await keychain('find-generic-password').then(
            () => true,
            () => false,
          )
        : platform === 'linux' && data !== undefined && data.vpns !== 0,
  };
}

async function dockerImages(): Promise<Found['docker']> {
  const bin = await findDocker().catch(() => undefined);
  if (!bin) {
    return undefined;
  }

  const docker = createDocker(bin);

  try {
    await docker.assertRunning();
    return { docker, images: await listVpnImages(docker) };
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) };
  }
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;

  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      total += (await lstat(join(entry.parentPath, entry.name)).catch(() => ({ size: 0 }))).size;
    }
  }

  return total;
}

/** How many VPNs the config holds; undefined if it can't be read, e.g. one written by a much older or newer version. */
async function countVpns(configFile: string): Promise<number | undefined> {
  try {
    return z
      .object({ vpns: z.array(z.unknown()) })
      .parse(JSON.parse(await readFile(configFile, 'utf8'))).vpns.length;
  } catch {
    return existsSync(configFile) ? undefined : 0;
  }
}

/** "360 MB", "1.1 GB": decimal units, as Docker reports sizes. */
export const formatBytes = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The question about the VPNs, or undefined when there are none to lose and the app's folder simply goes. */
export function keepQuestion(found: Found): string | undefined {
  const vpns = found.data?.vpns;
  if (!found.data || vpns === 0) {
    return undefined;
  }
  if (vpns === 1) {
    return 'Also delete your VPN and its saved passwords?';
  }

  return `Also delete your ${vpns === undefined ? 'VPNs' : `${vpns} VPNs`} and their saved passwords?`;
}

/**
 * What uninstall removes, in order. The helper goes first: the app isn't running, so no VPN is on, and removing it
 * puts the routes and DNS back as they were. The VPNs and passwords go only when `deleteVpns`, since they're the one
 * part that can't be downloaded again.
 */
export function uninstallSteps(found: Found, deleteVpns: boolean): Step[] {
  const steps: Step[] = [];
  const again = 'Run npx multi-vpn-client uninstall again.';
  const { appFolder, data } = found;

  if (found.helper) {
    steps.push({
      what: 'the network helper (asks for your password)',
      run: () => uninstallHelper(appFolder),
      manual: `${again} It asks for your password.`,
    });
  }

  if (found.cache) {
    const { dir, versions, bytes } = found.cache;
    const what =
      versions > 0
        ? `${plural(versions, 'downloaded version')}, ${formatBytes(bytes)}`
        : `the launcher's downloads, ${formatBytes(bytes)}`;
    steps.push({
      what,
      run: () => rm(dir, { recursive: true, force: true }),
      manual: `Delete the folder ${dir}`,
    });
  }

  if (found.desktopEntry.length > 0) {
    steps.push({
      what: "the app's entry in your app list",
      run: async () => {
        for (const path of found.desktopEntry) {
          await rm(path, { force: true });
        }
      },
      manual: `Delete ${found.desktopEntry.join(' and ')}`,
    });
  }

  const docker = found.docker;
  if (docker && 'problem' in docker) {
    steps.push({
      what: 'any VPN container images',
      reason: docker.problem,
      manual: `Start Docker, then ${again.toLowerCase()}`,
    });
  } else if (docker && docker.images.length > 0) {
    const refs = docker.images.map((image) => image.ref);
    steps.push({
      // "Up to": each image's size counts the base layers it shares with the others.
      what: `${plural(refs.length, 'VPN container image')}, up to ${formatBytes(docker.images.reduce((sum, image) => sum + image.bytes, 0))}`,
      // Containers left by a crash would keep their image in use.
      run: async () => {
        await removeStaleContainers(docker.docker);
        await docker.docker.runChecked(['image', 'rm', ...refs]);
      },
      manual: `docker image rm ${refs.join(' ')}`,
    });
  }

  const keepVpns = data !== undefined && data.vpns !== 0 && !deleteVpns;
  if (data && keepVpns && data.others.length > 0) {
    const others = data.others.map((entry) => join(appFolder, entry));
    steps.push({
      what: "sing-box and the app's caches",
      run: async () => {
        for (const path of others) {
          await rm(path, { recursive: true, force: true });
        }
      },
      manual: `Delete everything in ${appFolder} except ${[...KEPT_WITH_VPNS].join(', ')}`,
    });
  } else if (data && !keepVpns) {
    const what = data.vpns === 0 ? "the app's settings" : 'your VPNs and their saved passwords';
    steps.push({
      what,
      run: () => rm(appFolder, { recursive: true, force: true }),
      manual: `Delete the folder ${appFolder}`,
    });
  }

  // Also when the app's folder is already gone: the key is no use without the passwords it encrypted.
  if (found.keychainKey && !keepVpns) {
    steps.push(keychainStep(found.platform));
  }

  return steps;
}

/** Windows keeps the key in the app's folder, so it's only a step on macOS and Linux. */
function keychainStep(platform: NodeJS.Platform): Step {
  const what = `the key that encrypted your saved passwords ("${KEYCHAIN_SERVICE}")`;
  if (platform === 'darwin') {
    return {
      what,
      run: async () => {
        await keychain('delete-generic-password');
      },
      manual: `Delete "${KEYCHAIN_SERVICE}" in Keychain Access.`,
    };
  }

  // Which secret store holds it, and under which attributes, depends on the desktop; there's no one command for it.
  return {
    what,
    reason: 'If your keyring has it, which keyring that is depends on your desktop.',
    manual: `Delete "${KEYCHAIN_SERVICE}" in your keyring app (Passwords and Keys, or KWallet Manager).`,
  };
}

/** The npx cache entry this launcher runs from (…/_npx/<hash>), or undefined when it was started another way. */
export const npxEntry = (file: string) => /^(.*[\\/]_npx[\\/][^\\/]+)[\\/]/.exec(file)?.[1];
