import { Domain, RESOLVER_MARK } from '@repo/core';
import { runPowerShell, type RunPowerShell } from '../powershell.ts';
import type { DnsAdapter } from './index.ts';

/** Group Policy NRPT rules make Windows ignore local ones, silently. */
const GROUP_POLICY_NRPT =
  'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient\\DnsPolicyConfig';

const removeOurs = `Get-DnsClientNrptRule | Where-Object Comment -eq '${RESOLVER_MARK}' | Remove-DnsClientNrptRule -Force`;

/** The PowerShell that makes exactly `domains` resolve through `server`; exported for tests. */
export function nrptScript(domains: readonly string[], server: string): string {
  // Validated domains contain only letters, digits, dots and hyphens, so single quotes are safe.
  const valid = [...new Set(domains)].filter((domain) => Domain.safeParse(domain).success);
  return [
    "$ErrorActionPreference = 'Stop'",
    removeOurs,
    ...(valid.length > 0
      ? [
          `if ((Test-Path '${GROUP_POLICY_NRPT}') -and (Get-ChildItem '${GROUP_POLICY_NRPT}').Count -gt 0) {`,
          "  [Console]::Error.WriteLine('Domain routes are unavailable here: DNS rules on this PC are managed by Group Policy, which overrides ours.')",
          '  exit 3',
          '}',
          // ".corp.example" covers subdomains; the bare name is listed too, to be sure it's covered.
          ...valid.map(
            (domain) =>
              `Add-DnsClientNrptRule -Namespace '.${domain}','${domain}' -NameServers '${server}' -Comment '${RESOLVER_MARK}' | Out-Null`,
          ),
        ]
      : []),
    'Clear-DnsClientCache',
  ].join('\n');
}

/**
 * Per-domain DNS on Windows via NRPT rules (the Name Resolution Policy Table), marked with
 * a comment so only ours are ever removed. NRPT can't name a port, so the rules point at an
 * address inside the TUN where sing-box answers on port 53 (core/singbox: TUN_DNS_ADDRESS).
 */
export function createNrptDns({
  server,
  run = runPowerShell,
}: {
  server: string;
  run?: RunPowerShell;
}): DnsAdapter {
  return {
    set: (domains) => run(nrptScript(domains, server)),
    clear: () => run(nrptScript([], server)),
  };
}
