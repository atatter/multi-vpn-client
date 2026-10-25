import { NO_ROUTES, type HostRoutes, type VpnTunnel } from '@repo/core';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSingBoxBackend, stopLeftover } from './engine.ts';

const tunnel: VpnTunnel = {
  vpnId: 'a',
  port: 41_000,
  username: 'u',
  password: 'p',
  cidrs: ['10.20.0.0/16'],
  dns: { servers: ['10.20.0.53'], domains: ['corp.example'] },
};
const only = (...tunnels: VpnTunnel[]): HostRoutes => ({ tunnels, domains: [], blockIpv6: false });

/**
 * A stand-in sing-box: `check` fails for configs containing "reject-me";
 * `run` records each start and each SIGHUP, exits on SIGTERM, and crashes
 * when a `die` file appears.
 */
async function fakeSingBox() {
  const dir = await mkdtemp(join(tmpdir(), 'mvpn-engine-'));
  const path = join(dir, 'sing-box');
  const events = join(dir, 'events');
  await writeFile(
    path,
    `#!/bin/sh
if [ "$1" = check ]; then grep -q reject-me "$3" && { echo "bad config" >&2; exit 1; }; exit 0; fi
echo start >> ${events}
trap 'echo reload >> ${events}' HUP
trap 'echo stop >> ${events}; exit 0' TERM
while :; do sleep 0.1; [ -e ${join(dir, 'die')} ] && exit 3; done
`,
  );
  await chmod(path, 0o755);
  const sha = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
  const readEvents = async () =>
    (await readFile(events, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  const crash = () => writeFile(join(dir, 'die'), '');
  return { dir, path, sha, readEvents, crash };
}

/**
 * The stand-in is a shell script that traps SIGHUP and SIGTERM; Windows has neither. CI runs these on Linux and
 * macOS, and Windows' restart-instead-of-reload path is covered there by passing reload: "restart".
 */
const noFakeSingBox = process.platform === 'win32';

const recordingDns = () => {
  const calls: string[][] = [];
  return {
    calls,
    adapter: {
      set: async (domains: readonly string[]) => void calls.push([...domains]),
      clear: async () => void calls.push([]),
    },
  };
};

describe('sing-box backend', () => {
  it.skipIf(noFakeSingBox)('starts once, reloads on change, sets DNS, and tears down', async () => {
    const sb = await fakeSingBox();
    const dns = recordingDns();
    const backend = createSingBoxBackend({
      os: 'darwin',
      singBoxPath: sb.path,
      singBoxSha256: sb.sha,
      workDir: join(sb.dir, 'work'),
      dns: dns.adapter,
      log: () => undefined,
      onCrash: () => undefined,
    });

    await backend.apply(only(tunnel));
    await backend.apply(only({ ...tunnel, cidrs: ['10.30.0.0/16'] }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      JSON.parse(await readFile(join(sb.dir, 'work', 'config.json'), 'utf8')).route.rules[1]
        .ip_cidr,
    ).toEqual(['10.30.0.0/16']);
    await backend.apply(NO_ROUTES);

    expect(await sb.readEvents()).toEqual(['start', 'reload', 'stop']);
    expect(dns.calls).toEqual([['corp.example'], ['corp.example'], []]);
  });

  it.skipIf(noFakeSingBox)(
    "restarts instead of reloading where there's no SIGHUP (Windows)",
    async () => {
      const sb = await fakeSingBox();
      const backend = createSingBoxBackend({
        os: 'darwin',
        reload: 'restart',
        singBoxPath: sb.path,
        singBoxSha256: sb.sha,
        workDir: join(sb.dir, 'work'),
        dns: recordingDns().adapter,
        log: () => undefined,
        onCrash: () => undefined,
      });
      await backend.apply(only(tunnel));
      await backend.apply(only({ ...tunnel, cidrs: ['10.30.0.0/16'] }));
      await backend.stop();
      expect(await sb.readEvents()).toEqual(['start', 'stop', 'start', 'stop']);
    },
  );

  it.skipIf(noFakeSingBox)(
    'routes domains through the resolver and the generated config',
    async () => {
      const sb = await fakeSingBox();
      const dns = recordingDns();
      const backend = createSingBoxBackend({
        os: 'darwin',
        singBoxPath: sb.path,
        singBoxSha256: sb.sha,
        workDir: join(sb.dir, 'work'),
        dns: dns.adapter,
        log: () => undefined,
        onCrash: () => undefined,
      });
      await backend.apply({
        blockIpv6: false,
        tunnels: [{ ...tunnel, cidrs: [] }],
        domains: [{ vpnId: 'a', domain: 'argo.lab.example' }],
      });
      const config = JSON.parse(await readFile(join(sb.dir, 'work', 'config.json'), 'utf8'));
      expect(config.route.rules[1]).toEqual({
        domain_suffix: ['argo.lab.example'],
        action: 'route',
        outbound: 'vpn-a',
      });
      expect(dns.calls).toEqual([['argo.lab.example', 'corp.example']]);
      await backend.stop();
    },
  );

  it.skipIf(noFakeSingBox)('only routes DNS for VPNs that have a DNS server', async () => {
    const sb = await fakeSingBox();
    const dns = recordingDns();
    const backend = createSingBoxBackend({
      os: 'darwin',
      singBoxPath: sb.path,
      singBoxSha256: sb.sha,
      workDir: join(sb.dir, 'work'),
      dns: dns.adapter,
      log: () => undefined,
      onCrash: () => undefined,
    });
    await backend.apply(only({ ...tunnel, dns: { servers: [], domains: ['corp.example'] } }));
    expect(dns.calls).toEqual([[]]);
    await backend.stop();
  });

  it("refuses to run a binary that doesn't match its checksum", async () => {
    const sb = await fakeSingBox();
    const backend = createSingBoxBackend({
      os: 'darwin',
      singBoxPath: sb.path,
      singBoxSha256: '0'.repeat(64),
      workDir: join(sb.dir, 'work'),
      dns: recordingDns().adapter,
      log: () => undefined,
      onCrash: () => undefined,
    });
    await expect(backend.apply(only(tunnel))).rejects.toThrow('checksum');
    expect(await sb.readEvents()).toEqual([]);
  });

  it.skipIf(noFakeSingBox)('keeps the old config when sing-box rejects the new one', async () => {
    const sb = await fakeSingBox();
    const work = join(sb.dir, 'work');
    const backend = createSingBoxBackend({
      os: 'darwin',
      singBoxPath: sb.path,
      singBoxSha256: sb.sha,
      workDir: work,
      dns: recordingDns().adapter,
      log: () => undefined,
      onCrash: () => undefined,
    });
    await backend.apply(only(tunnel));
    const before = await readFile(join(work, 'config.json'), 'utf8');
    // A domain like this can't come from validated input; it's just a way to make the fake `check` fail.
    await expect(
      backend.apply(
        only({ ...tunnel, dns: { servers: ['10.20.0.53'], domains: ['reject-me.example'] } }),
      ),
    ).rejects.toThrow('bad config');
    expect(await readFile(join(work, 'config.json'), 'utf8')).toBe(before);
    await backend.stop();
  });

  it.skipIf(noFakeSingBox)('reports an unexpected exit', async () => {
    const sb = await fakeSingBox();
    let crashed = false;
    const backend = createSingBoxBackend({
      os: 'darwin',
      singBoxPath: sb.path,
      singBoxSha256: sb.sha,
      workDir: join(sb.dir, 'work'),
      dns: recordingDns().adapter,
      log: () => undefined,
      onCrash: () => void (crashed = true),
    });
    await backend.apply(only(tunnel));
    await sb.crash();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(crashed).toBe(true);
  });

  it.skipIf(noFakeSingBox)(
    "answers with sing-box's reason when it can't start, without ending the session",
    async () => {
      const sb = await fakeSingBox();
      // A fake that fails like a sing-box whose DNS port is taken, colouring its level as the real one does.
      await writeFile(
        sb.path,
        `#!/bin/sh
if [ "$1" = check ]; then exit 0; fi
printf '\\033[31mFATAL\\033[0m[0000] start service: start inbound/direct[dns-in]: listen tcp 127.0.0.1:53530: bind: address already in use\\n' >&2
exit 1
`,
      );
      const sha = createHash('sha256')
        .update(await readFile(sb.path))
        .digest('hex');
      let crashed = false;
      const backend = createSingBoxBackend({
        os: 'darwin',
        singBoxPath: sb.path,
        singBoxSha256: sha,
        workDir: join(sb.dir, 'work'),
        dns: recordingDns().adapter,
        log: () => undefined,
        onCrash: () => void (crashed = true),
      });
      await expect(backend.apply(only(tunnel))).rejects.toThrow(
        'sing-box failed to start: start service: start inbound/direct[dns-in]: listen tcp 127.0.0.1:53530: bind: address already in use',
      );
      expect(crashed).toBe(false);
    },
  );
});

describe('stopLeftover', () => {
  it.skipIf(noFakeSingBox)(
    "stops a process running exactly the helper's sing-box and config, and nothing else",
    async () => {
      const sb = await fakeSingBox();
      const work = join(sb.dir, 'work');
      const leftover = spawn(sb.path, ['run', '-c', join(work, 'config.json')], {
        stdio: 'ignore',
      });
      const unrelated = spawn(sb.path, ['run', '-c', join(sb.dir, 'elsewhere.json')], {
        stdio: 'ignore',
      });
      const gone = new Promise((resolve) => leftover.once('exit', resolve));
      try {
        await stopLeftover({
          singBoxPath: sb.path,
          workDir: work,
          log: () => undefined,
          // The fake runs under /bin/sh, so `ps` would show the shell; the command lines are what the real one shows.
          processes: async () => [
            { pid: leftover.pid ?? 0, command: `${sb.path} run -c ${join(work, 'config.json')}` },
            {
              pid: unrelated.pid ?? 0,
              command: `${sb.path} run -c ${join(sb.dir, 'elsewhere.json')}`,
            },
          ],
        });
        await gone;
        expect(unrelated.exitCode).toBeNull();
        expect(unrelated.signalCode).toBeNull();
      } finally {
        unrelated.kill('SIGKILL');
      }
    },
  );
});
