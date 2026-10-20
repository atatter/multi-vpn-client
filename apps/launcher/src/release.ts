import { isAbsolute, join } from "node:path";
import { z } from "zod";

/**
 * The release a launcher starts, written by scripts/pack.ts into release.json beside the bundled launcher. It ships
 * inside the npm package, so the checksums are fixed when the package is published: whoever can replace a GitHub
 * Release asset still can't make the launcher run it.
 */
export const Manifest = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  archives: z.record(
    z.string(),
    z.object({ file: z.string().regex(/^[\w.-]+$/), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  ),
});
export type Manifest = z.infer<typeof Manifest>;
export type Archive = Manifest["archives"][string];

/** Every machine a release is built for, and its archive type. Must match the targets in apps/desktop/electron-builder.yml. */
export const ARCHIVE_TYPES = {
  "darwin-arm64": "tar.gz",
  "darwin-x64": "tar.gz",
  "linux-x64": "tar.gz",
  "linux-arm64": "tar.gz",
  "win32-x64": "zip",
} as const;
export type Target = keyof typeof ARCHIVE_TYPES;
export const isTarget = (key: string): key is Target => key in ARCHIVE_TYPES;

/** electron-builder.yml's artifactName for this version and machine. */
export const archiveFile = (version: string, target: Target) => `multi-vpn-client-${version}-${target}.${ARCHIVE_TYPES[target]}`;

const RELEASES_URL = "https://github.com/atatter/multi-vpn-client/releases/download";

/** "darwin-arm64", "linux-x64", "win32-x64"…: the key an archive is listed under, as Node names the machine. */
export const targetOf = (platform: NodeJS.Platform, arch: string) => `${platform}-${arch}`;

/** The release's asset, or the same file under MVPN_RELEASE_URL, for trying archives before they're published. */
export const archiveUrl = (manifest: Manifest, archive: Archive, env: NodeJS.ProcessEnv) =>
  `${env.MVPN_RELEASE_URL || `${RELEASES_URL}/v${manifest.version}`}/${archive.file}`;

/** Where unpacked versions live, one folder each: the OS's per-user cache, since a version can always be downloaded again. */
export function versionsDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  // Empty or relative values are ignored, never resolved against the cwd.
  const absolute = (value: string | undefined) => (value && isAbsolute(value) ? value : undefined);
  if (platform === "win32") return join(absolute(env.LOCALAPPDATA) ?? join(home, "AppData", "Local"), "Multi VPN Client", "versions");
  if (platform === "darwin") return join(home, "Library", "Caches", "Multi VPN Client", "versions");
  return join(absolute(env.XDG_CACHE_HOME) ?? join(home, ".cache"), "multi-vpn-client", "versions");
}

/** The app's executable inside an unpacked version. Must match productName and linux.executableName in electron-builder.yml. */
export function executableIn(versionDir: string, platform: NodeJS.Platform): string {
  if (platform === "darwin") return join(versionDir, "Multi VPN Client.app", "Contents", "MacOS", "Multi VPN Client");
  if (platform === "win32") return join(versionDir, "Multi VPN Client.exe");
  return join(versionDir, "multi-vpn-client");
}

/**
 * Electron's sandbox needs unprivileged user namespaces or a setuid-root chrome-sandbox. Ubuntu 23.10+ blocks the
 * first with AppArmor, and an unpacked archive can't have the second, so there the window runs without Chromium's
 * sandbox. It's still context-isolated and only ever loads the app's own files.
 */
export const needsNoSandbox = (platform: NodeJS.Platform, restrictUserns: string | undefined) =>
  platform === "linux" && restrictUserns?.trim() === "1";
