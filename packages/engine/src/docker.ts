import type { DockerState } from '@repo/core';
import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { run, runChecked } from './process.ts';

/** A daemon that's still booting can leave `docker info` hanging; past this it counts as not running. */
const INFO_TIMEOUT_MS = 10_000;

/** Docker Desktop takes from seconds to a minute or two to boot, longest on Windows. */
const START_TIMEOUT_MS = 120_000;

/**
 * Thin wrapper over the docker CLI. Using the CLI (not the socket API) means it
 * works with whatever context Docker Desktop / Colima / OrbStack configured.
 */

/** Where Docker Desktop and Homebrew put the CLI; apps started from Finder or the Start menu may not get the shell's PATH. */
function knownLocations(platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') {
    return [
      join(env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe')] : []),
    ];
  }
  return ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker'];
}

export async function findDocker(path = process.env.PATH ?? ''): Promise<string> {
  const name = process.platform === 'win32' ? 'docker.exe' : 'docker';
  const candidates = [...path.split(delimiter).filter(Boolean).map((dir) => join(dir, name)), ...knownLocations()];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error("Docker isn't installed (no docker command found). Install Docker Desktop and try again.");
}

export type Docker = ReturnType<typeof createDocker>;

export function createDocker(bin: string) {
  return {
    bin,
    run: (args: readonly string[], input?: string | Buffer) => run(bin, args, input),
    runChecked: (args: readonly string[], input?: string | Buffer) => runChecked(bin, args, input),

    /** Throws a readable error when the daemon isn't reachable (e.g. Docker Desktop not started). */
    async assertRunning() {
      const result = await run(bin, ['info', '--format', '{{.ServerVersion}}'], undefined, INFO_TIMEOUT_MS);
      if (result.code !== 0) {
        const reason = result.stderr.trim().split('\n').at(-1) ?? '';
        throw new Error(`Docker isn't reachable. Start Docker Desktop and try again.${reason ? `\n${reason}` : ''}`);
      }
    },
  };
}

/** Whether Docker is installed and running. */
export async function dockerState(): Promise<DockerState> {
  const bin = await findDocker().catch(() => undefined);
  if (!bin) return 'missing';
  return createDocker(bin).assertRunning().then(
    () => 'running',
    () => 'stopped',
  );
}

/**
 * Starts Docker and resolves once it answers, so a caller can show it as starting for as long as it really is.
 * Throws when the app can't start it or it doesn't come up in time.
 */
export async function startDocker(): Promise<void> {
  await launchDocker();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while ((await dockerState()) !== 'running') {
    if (Date.now() > deadline) throw new Error(`Docker didn't start within ${START_TIMEOUT_MS / 60_000} minutes. Open Docker Desktop to see why.`);
    await sleep(1000);
  }
}

/** Launches Docker Desktop where the app can (macOS, Windows, Docker Desktop for Linux); says how otherwise. */
async function launchDocker(): Promise<void> {
  const launch = (command: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  if (process.platform === 'darwin') {
    // `open` returns once the app is launched, and fails when there's no Docker Desktop (Colima, OrbStack).
    const opened = await run('open', ['-a', 'Docker']);
    if (opened.code !== 0) throw new Error("Docker Desktop isn't installed, so the app can't start Docker. Start the Docker you use, such as Colima or OrbStack.");
    return;
  }
  if (process.platform === 'win32') return launch(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'), []);
  // Docker Desktop for Linux is a user service; Docker Engine needs root, which the app doesn't have.
  const started = await new Promise<boolean>((resolve) => {
    const child = spawn('systemctl', ['--user', 'start', 'docker-desktop'], { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
  if (!started) throw new Error('Start Docker from a terminal: sudo systemctl start docker');
}
