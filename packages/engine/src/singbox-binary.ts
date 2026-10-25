import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run, runChecked } from './process.ts';
import { SING_BOX_VERSION } from '@repo/vpn-sdk/container';
import { SING_BOX_HOST, singBoxFolder, singBoxUrl, type SingBoxPlatform } from './release.ts';

/**
 * The pinned sing-box for this machine, downloaded into the app's data folder
 * on first use. The archive is verified before unpacking, and the binary is
 * verified against its pinned hash every time (the folder is user-writable).
 */

export interface SingBoxBinary {
  path: string;
  /** SHA-256 of the binary itself, re-checked by the helper installer as root. */
  sha256: string;
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const isSingBoxPlatform = (key: string): key is SingBoxPlatform => key in SING_BOX_HOST;

export function hostPlatform(platform = process.platform, arch = process.arch): SingBoxPlatform {
  const key = `${platform}-${arch === 'x64' ? 'amd64' : arch}`;
  if (isSingBoxPlatform(key)) {
    return key;
  }

  throw new Error(`This OS/architecture (${platform}/${arch}) isn't supported yet.`);
}

export async function ensureSingBox(binDir: string): Promise<SingBoxBinary> {
  const platform = hostPlatform();
  const pinned = SING_BOX_HOST[platform];
  const dir = join(binDir, `sing-box-${SING_BOX_VERSION}`);
  const path = join(dir, process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');

  const cached = await readFile(path).catch(() => undefined);
  if (cached && sha256(cached) === pinned.binary) {
    return { path, sha256: pinned.binary };
  }

  // Missing or not the pinned binary: (re)download.
  const response = await fetch(singBoxUrl(platform));
  if (!response.ok) {
    throw new Error(`Downloading sing-box failed: HTTP ${response.status}`);
  }

  const archive = Buffer.from(await response.arrayBuffer());
  if (sha256(archive) !== pinned.archive) {
    throw new Error("The downloaded sing-box doesn't match its pinned checksum.");
  }

  await mkdir(binDir, { recursive: true });
  const staging = await mkdtemp(join(binDir, '.download-'));

  try {
    // Windows' own tar (bsdtar) unpacks .zip; Git for Windows' GNU tar earlier on PATH can't.
    const tar =
      process.platform === 'win32'
        ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar';
    const archivePath = join(staging, pinned.asset);
    await writeFile(archivePath, archive);
    await runChecked(tar, ['-xf', archivePath, '-C', staging]);
    await rm(dir, { recursive: true, force: true });
    await rename(join(staging, singBoxFolder(platform)), dir);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  if (sha256(await readFile(path)) !== pinned.binary) {
    throw new Error("The unpacked sing-box doesn't match its pinned checksum.");
  }

  // Verified; make sure Gatekeeper doesn't block it as a quarantined download.
  if (process.platform === 'darwin') {
    await run('/usr/bin/xattr', ['-d', 'com.apple.quarantine', path]);
  }

  return { path, sha256: pinned.binary };
}
