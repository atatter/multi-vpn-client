import { Domain } from '@repo/core';
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import type { DnsAdapter } from './index.ts';

/** Runs a command (no shell); rejects with its stderr on failure. */
export type Exec = (command: string, args: readonly string[]) => Promise<void>;

const exec: Exec = (command, args) =>
  new Promise((resolve, reject) =>
    execFile(command, args, { timeout: 10_000 }, (error, _stdout, stderr) =>
      error ? reject(new Error(stderr.trim() || error.message)) : resolve(),
    ),
  );

/**
 * Per-domain DNS on Linux through systemd-resolved. The settings live on a dummy
 * interface whose own address the sing-box DNS listener binds to: resolved may pin
 * its query socket to the interface, and the interface's own address is the one
 * that's still delivered locally then. The interface outlives sing-box reloads (which
 * recreate the TUN); each `set` replaces its settings, and deleting it drops them.
 *
 * Needs CAP_NET_ADMIN for the interface, and polkit permission for the resolved calls
 * (granted to the helper's user, for this interface only, by the installer).
 */
export function createResolvedDns({
  address,
  port,
  link = 'mvpn-dns',
  run = exec,
}: {
  address: string;
  port: number;
  link?: string;
  run?: Exec;
}): DnsAdapter {
  const resolvectl = (...args: string[]) => run('resolvectl', ['--no-ask-password', ...args]);

  async function removeLink() {
    await run('ip', ['link', 'del', link]).catch(() => undefined); // already gone
  }

  return {
    async set(domains) {
      const valid = [...new Set(domains)].filter((domain) => Domain.safeParse(domain).success);
      if (valid.length === 0) {
        return removeLink();
      }

      const exists = await run('ip', ['link', 'show', link]).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await run('ip', ['link', 'add', link, 'type', 'dummy']);
        await run('ip', ['address', 'add', `${address}/32`, 'dev', link]);
        await run('ip', ['link', 'set', link, 'up']);
      }

      // resolved learns about new links asynchronously, so the first call can race it.
      for (let attempt = 1; ; attempt++) {
        try {
          await resolvectl('dns', link, `${address}:${port}`);
          break;
        } catch (error) {
          if (attempt === 20) {
            throw new Error(
              `Domain routes need systemd-resolved: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          await sleep(100);
        }
      }

      // "~" makes them routing-only domains: just these names go here, nothing is searched.
      await resolvectl('domain', link, ...valid.map((domain) => `~${domain}`));
      await resolvectl('default-route', link, 'false');
    },
    clear: removeLink,
  };
}
