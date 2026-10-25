import { Domain, RESOLVER_MARK } from '@repo/core';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DnsAdapter } from './index.ts';

const flushMacDns = () =>
  new Promise<void>((resolve) => execFile('/usr/bin/killall', ['-HUP', 'mDNSResponder'], { timeout: 5_000 }, () => resolve()));

/**
 * Per-domain DNS on macOS via /etc/resolver/<domain> files (see resolver(5)),
 * pointing at sing-box's DNS address inside its TUN (core/singbox: TUN_DNS_ADDRESS), on port 53. Domains are validated again here,
 * because they become file names in a root-owned directory.
 */
export function createResolverDns({ server, dir = '/etc/resolver', flush = flushMacDns }: { server: string; dir?: string; flush?: () => Promise<void> }): DnsAdapter {
  async function removeOurs() {
    const names = await readdir(dir).catch(() => []);
    for (const name of names) {
      const path = join(dir, name);
      const firstLine = (await readFile(path, 'utf8').catch(() => '')).split('\n', 1)[0];
      if (firstLine === RESOLVER_MARK) await rm(path, { force: true });
    }
  }

  return {
    async set(domains) {
      await removeOurs();
      await mkdir(dir, { recursive: true });
      for (const domain of new Set(domains)) {
        if (!Domain.safeParse(domain).success) continue;
        // Leaves a resolver entry someone else created alone.
        await writeFile(join(dir, domain), `${RESOLVER_MARK}\nnameserver ${server}\n`, { flag: 'wx', mode: 0o644 }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error;
          },
        );
      }
      await flush();
    },
    async clear() {
      await removeOurs();
      await flush();
    },
  };
}
