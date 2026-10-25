import { hostSingBoxConfig, resolverDomains, type HostOs } from '@repo/core';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DnsAdapter } from './dns/index.ts';
import type { HostBackend } from './server.ts';
import { localIpv6Networks } from './local-ipv6.ts';

/** Without terminal colour codes, which sing-box puts around its level ("\x1b[31mFATAL\x1b[0m"). */
// The escape character is what's being matched.
// oxlint-disable-next-line no-control-regex
const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');

const runArgs = (workDir: string) => ['run', '-c', join(workDir, 'config.json')];

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Every process's PID and full command line, on macOS and Linux. By absolute path: a daemon's PATH is minimal.
 * `-ww` so a long command line is never cut to a column width.
 */
const processList = () =>
  new Promise<{ pid: number; command: string }[]>((resolve, reject) =>
    execFile('/bin/ps', ['-A', '-ww', '-o', 'pid=,command='], { timeout: 5_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
      error
        ? reject(new Error(`listing processes failed: ${error.message}`))
        : resolve(
            stdout.split('\n').flatMap((line) => {
              const match = /^\s*(\d+) (.*)$/.exec(line);
              return match?.[1] && match[2] !== undefined ? [{ pid: Number(match[1]), command: match[2] }] : [];
            }),
          ),
    ),
  );

/**
 * Stops a sing-box a previous helper run left behind when it was killed outright: its TUN routes (and on Linux
 * its interface and DNS listener) would keep a new one from starting. Only an exact match of this binary and
 * config is stopped, as on Windows (main.ts).
 */
export async function stopLeftover({
  singBoxPath,
  workDir,
  log,
  processes = processList,
}: {
  singBoxPath: string;
  workDir: string;
  log: (line: string) => void;
  processes?: () => Promise<{ pid: number; command: string }[]>;
}) {
  const ours = [singBoxPath, ...runArgs(workDir)].join(' ');
  const running = await processes();
  log(`looking for a leftover sing-box among ${running.length} processes`);
  for (const { pid } of running.filter((entry) => entry.command === ours)) {
    log(`stopping the sing-box a previous run left behind (pid ${pid})`);
    process.kill(pid, 'SIGTERM');
    for (let waited = 0; waited < 5_000 && isRunning(pid); waited += 100) await sleep(100);
    if (isRunning(pid)) process.kill(pid, 'SIGKILL');
  }
}

/**
 * Runs sing-box (the TUN routing engine) for the helper. The config is always
 * built here from validated tunnels; the binary's hash is checked before every
 * start. Route changes reload sing-box in place (SIGHUP), or restart it on
 * Windows, which has no SIGHUP. Either way sing-box rebuilds everything.
 */
export function createSingBoxBackend({
  os,
  singBoxPath,
  singBoxSha256,
  workDir,
  dns,
  log,
  onCrash,
  reload = os === 'win32' ? 'restart' : 'signal',
}: {
  os: HostOs;
  singBoxPath: string;
  singBoxSha256: string;
  workDir: string;
  dns: DnsAdapter;
  log: (line: string) => void;
  /** sing-box exited on its own; the caller should end the session so the app notices. */
  onCrash: () => void;
  reload?: 'signal' | 'restart';
}): HostBackend & { stop(): Promise<void> } {
  const configPath = join(workDir, 'config.json');
  let child: ChildProcess | undefined;

  const check = (path: string) =>
    new Promise<void>((resolve, reject) =>
      execFile(singBoxPath, ['check', '-c', path], { timeout: 10_000 }, (error, _stdout, stderr) =>
        error ? reject(new Error(`Invalid routing config: ${stderr.trim() || error.message}`)) : resolve(),
      ),
    );

  /** Runs before every use of the binary with the helper's privileges, including `check`. */
  async function verifyBinary() {
    const hash = createHash('sha256').update(await readFile(singBoxPath)).digest('hex');
    if (hash !== singBoxSha256) throw new Error("sing-box binary doesn't match its checksum; reinstall the helper.");
  }

  async function start() {
    // Output goes through the helper's log; on Windows nothing else would capture it.
    const engine = spawn(singBoxPath, runArgs(workDir), { stdio: ['ignore', 'pipe', 'pipe'] });
    let lastLine = '';
    for (const stream of [engine.stdout, engine.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        lastLine = line;
        log(`sing-box: ${line}`);
      });
    }
    child = engine;
    let started = false;
    engine.on('exit', (code, signal) => {
      if (child !== engine) return; // stopped on purpose
      child = undefined;
      log(`sing-box exited unexpectedly (${signal ?? code})`);
      // While starting, apply answers with the reason; afterwards the session ends so the app notices.
      if (started) onCrash();
    });
    await sleep(1000);
    // sing-box's own last line says why, e.g. "… bind: address already in use".
    if (child !== engine) throw new Error(`sing-box failed to start: ${plain(lastLine).replace(/^FATAL\[\d+\]\s*/, '') || 'see the helper log'}`);
    started = true;
  }

  async function stop() {
    const engine = child;
    child = undefined;
    if (!engine) return;
    const exited = new Promise<void>((resolve) => engine.once('exit', () => resolve()));
    engine.kill('SIGTERM');
    await Promise.race([exited, sleep(5000).then(() => engine.kill('SIGKILL'))]);
  }

  return {
    async apply(routes) {
      if (routes.tunnels.length === 0) {
        await stop();
        await dns.clear();
        return;
      }
      await verifyBinary();
      await mkdir(workDir, { recursive: true, mode: 0o700 });
      const candidate = `${configPath}.next`;
      const config = hostSingBoxConfig(routes, { os, cachePath: join(workDir, 'cache.db'), localIpv6: localIpv6Networks() });
      await writeFile(candidate, JSON.stringify(config, null, 2), { mode: 0o600 });
      try {
        await check(candidate);
      } catch (error) {
        await rm(candidate, { force: true });
        throw error;
      }
      await rename(candidate, configPath);

      // DNS first: on Linux the DNS listener's address only exists once the DNS settings do.
      await dns.set(resolverDomains(routes));
      if (child && reload === 'signal') child.kill('SIGHUP');
      else {
        await stop();
        await start();
      }
    },
    stop,
  };
}
