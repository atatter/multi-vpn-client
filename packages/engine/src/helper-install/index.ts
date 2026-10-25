import { HELPER_PORT, HELPER_VERSION, type HelperState } from '@repo/core';
import { writeJsonAtomic } from '@repo/core/fs';
import { helperKey } from '@repo/core/helper-crypto';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { helperVersion } from '../helper-client.ts';
import type { SingBoxBinary } from '../singbox-binary.ts';
import { darwinInstaller } from './darwin.ts';
import { linuxInstaller } from './linux.ts';
import { win32Installer } from './win32.ts';

/**
 * Installs the network helper once (one admin prompt), so connecting never
 * prompts again. Each OS has its own service manager and admin prompt
 * (helper-install/<os>.ts); the trust model is the same everywhere.
 *
 * Trust model: the app (as you) picks a random token and keeps it in its
 * private data folder; the helper keeps the handshake key derived from it in a
 * file only it (and administrators) can read (core/helper-crypto). Neither is
 * ever sent over the wire. Binaries are copied to admin-owned locations and
 * their checksums verified there, with admin rights.
 */

/** What an OS installer gets: binaries to copy (with the checksums they must have) and the helper's settings. */
export interface InstallPlan {
  helperBinary: string;
  helperSha256: string;
  singBox: SingBoxBinary;
  /** The helper's settings, including the handshake key: keep it off command lines and out of readable files. */
  configJson: string;
}

export interface PlatformInstaller {
  /** Where the helper's log is, shown when it doesn't respond. */
  logHint: string;
  isInstalled(): boolean;
  install(plan: InstallPlan): Promise<void>;
  uninstall(): Promise<void>;
}

const INSTALLERS: Partial<Record<NodeJS.Platform, PlatformInstaller>> = { darwin: darwinInstaller, linux: linuxInstaller, win32: win32Installer };
const platformInstaller = () => INSTALLERS[process.platform];

export const helperLogHint = () => platformInstaller()?.logHint ?? '';

/** Whether the helper's service is on this machine, responding or not. */
export const helperInstalled = () => platformInstaller()?.isInstalled() ?? false;

const HelperSecret = z.object({ token: z.string().min(1) });
const secretPath = (dataDir: string) => join(dataDir, 'helper.json');

export async function readHelperToken(dataDir: string): Promise<string | undefined> {
  try {
    return HelperSecret.parse(JSON.parse(await readFile(secretPath(dataDir), 'utf8'))).token;
  } catch {
    return undefined;
  }
}

export async function helperState(dataDir: string): Promise<HelperState> {
  const installer = platformInstaller();
  if (!installer) return 'unsupported';
  const version = await helperVersion(HELPER_PORT);
  if (version === undefined) return installer.isInstalled() ? 'not-responding' : 'not-installed';
  if (version !== HELPER_VERSION || !(await readHelperToken(dataDir))) return 'needs-update';
  return 'ready';
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function requireInstaller(): PlatformInstaller {
  const installer = platformInstaller();
  if (!installer) throw new Error(`The network helper isn't available on ${process.platform} yet.`);
  return installer;
}

export async function installHelper({ dataDir, helperBinary, singBox }: { dataDir: string; helperBinary: string; singBox: SingBoxBinary }): Promise<void> {
  const installer = requireInstaller();
  const binary = await readFile(helperBinary).catch(() => {
    throw new Error(`Helper binary not found at ${helperBinary}. Run "pnpm build:helper".`);
  });
  const token = randomBytes(32).toString('base64url');
  const configJson = JSON.stringify({ key: helperKey(token).toString('hex'), singBoxSha256: singBox.sha256 });

  await installer.install({ helperBinary, helperSha256: sha256(binary), singBox, configJson });

  // The token stays in your private app data folder; the helper only has the key derived from it.
  await writeJsonAtomic(secretPath(dataDir), { token }, 0o600);

  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await helperVersion(HELPER_PORT)) === HELPER_VERSION) return;
    await sleep(250);
  }
  throw new Error(`The network helper was installed but isn't responding. Its log: ${installer.logHint}`);
}

export async function uninstallHelper(dataDir: string): Promise<void> {
  await requireInstaller().uninstall();
  await rm(secretPath(dataDir), { force: true });
}
