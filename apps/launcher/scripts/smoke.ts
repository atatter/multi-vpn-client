// Checks a packed release on the machine that built it: the npm package's launcher answers, its install code takes
// this machine's archive from a local copy of the release (checksum, unpack), and the app starts and keeps running.
// Everything goes to a scratch home, so it never touches a real install. On Linux, run it under xvfb-run.
//   node apps/launcher/scripts/smoke.ts --package npm-package --archives apps/desktop/dist
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { ensureInstalled, Manifest, targetOf, versionsDir } from '@repo/release';
import { needsNoSandbox, readOptional } from '../src/start.ts';

const { values } = parseArgs({
  options: { package: { type: 'string' }, archives: { type: 'string' } },
});
const { package: packageDir, archives } = values;
if (!packageDir || !archives)
  throw new Error('Usage: smoke.ts --package <npm package dir> --archives <dir>');

const manifest = Manifest.parse(JSON.parse(readFileSync(join(packageDir, 'release.json'), 'utf8')));
const launcherVersion = execFileSync(process.execPath, [join(packageDir, 'bin.mjs'), '--version'], {
  encoding: 'utf8',
}).trim();
if (launcherVersion !== manifest.version)
  throw new Error(`The launcher says ${launcherVersion}, its release.json ${manifest.version}.`);

const server = createServer((request, response) => {
  readFile(join(archives, (request.url ?? '').slice(1))).then(
    (body) => response.end(body),
    () => response.writeHead(404).end(),
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const scratch = mkdtempSync(join(tmpdir(), 'mvpn-smoke-'));
const env = {
  ...process.env,
  MVPN_RELEASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  HOME: scratch,
  USERPROFILE: scratch,
  APPDATA: join(scratch, 'roaming'),
  LOCALAPPDATA: join(scratch, 'local'),
  XDG_CACHE_HOME: join(scratch, 'cache'),
  XDG_CONFIG_HOME: join(scratch, 'config'),
};

const { platform } = process;
const executable = await ensureInstalled({
  manifest,
  target: targetOf(platform, process.arch),
  dir: versionsDir(env, platform, scratch),
  platform,
  env,
});
server.close();

const noSandbox = needsNoSandbox(
  platform,
  readOptional('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'),
);
const output: string[] = [];
const app = spawn(executable, noSandbox ? ['--no-sandbox'] : [], {
  env,
  detached: platform !== 'win32',
});
app.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
app.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
const exited = new Promise<number | null>((resolve) => app.once('exit', resolve));

const RUNNING_FOR_MS = 20_000;
const early = await Promise.race([exited, sleep(RUNNING_FOR_MS).then(() => 'running' as const)]);
if (early !== 'running') {
  console.error(output.join(''));
  throw new Error(
    `Multi VPN Client ${manifest.version} exited (code ${early}) within ${RUNNING_FOR_MS / 1000} s of starting.`,
  );
}
// Stop the app and the processes it started (renderer, GPU), by the pid captured at spawn. Forcefully: on macOS the
// app outlived SIGTERM and its open output pipes kept this script running.
if (platform === 'win32')
  execFileSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
else if (app.pid) process.kill(-app.pid, 'SIGKILL');
app.stdout.destroy();
app.stderr.destroy();
console.log(
  `Multi VPN Client ${manifest.version} installed from its archive and kept running for ${RUNNING_FOR_MS / 1000} s.`,
);
