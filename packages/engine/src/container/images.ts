import { VPN_IMAGE_PREFIX, type VpnImage } from '@repo/vpn-sdk/container';
import type { OneOffRun } from '@repo/vpn-sdk/engine';
import type { Docker } from '../docker.ts';
import { dnsFlags } from './start.ts';

// Every VPN client's image is defined with the client (@repo/vpns); the engine builds and runs them.

/** Image builds in flight by tag, so concurrent callers (two connects, or an action) share one. */
const building = new Map<string, Promise<void>>();

/**
 * Builds the image unless it already exists. The Dockerfile has no build context, so it's piped on stdin.
 * A build that's already running is shared; its output goes to the first caller's log.
 */
export function ensureVpnImage(docker: Docker, image: VpnImage, onLog: (line: string) => void): Promise<void> {
  const running = building.get(image.tag);
  if (running) return running;
  const build = (async () => {
    if ((await docker.run(['image', 'inspect', image.tag])).code === 0) return;
    onLog(`Building ${image.tag} (first time only)…`);
    const result = await docker.run(['build', '--tag', image.tag, '-'], image.dockerfile);
    const lines = result.stderr.split('\n').filter((line) => line.trim());
    for (const line of lines.slice(-20)) onLog(line);
    if (result.code !== 0) throw new Error(`Building the VPN container image failed: ${lines.at(-1)?.trim() ?? `exit ${result.code}`}`);
  })().finally(() => building.delete(image.tag));
  building.set(image.tag, build);
  return build;
}

/** Runs a one-off container of `image`, built first if needed, and removes it; for an integration's actions. Its output is returned, not logged. */
export async function runInImage(docker: Docker, image: VpnImage, { entrypoint, args, env = {} }: OneOffRun) {
  await ensureVpnImage(docker, image, () => undefined);
  const envFlags = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
  return docker.run(['run', '--rm', ...dnsFlags([]), ...envFlags, '--entrypoint', entrypoint, image.tag, ...args]);
}

/** Every VPN image on this machine, built by any version of the app, with its size in bytes. */
export async function listVpnImages(docker: Docker) {
  const listed = await docker.runChecked(['image', 'ls', '--filter', `reference=${VPN_IMAGE_PREFIX}*`, '--format', '{{.Repository}}:{{.Tag}}']);
  const refs = listed.split('\n').filter(Boolean);
  if (refs.length === 0) return [];
  const sizes = (await docker.runChecked(['image', 'inspect', '--format', '{{.Size}}', ...refs])).split('\n');
  return refs.map((ref, index) => ({ ref, bytes: Number(sizes[index]) || 0 }));
}
