import { RESOLVER_MARK } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { createNrptDns, nrptScript } from './win32.ts';

describe('NRPT DNS', () => {
  it('replaces only our rules, with one rule per valid domain covering it and its subdomains', () => {
    const script = nrptScript(
      ['corp.example', 'corp.example', "x'; Remove-Item C:\\ -Recurse #", 'b.internal'],
      '198.18.0.2',
    );
    expect(script).toContain(
      `Get-DnsClientNrptRule | Where-Object Comment -eq '${RESOLVER_MARK}' | Remove-DnsClientNrptRule -Force`,
    );
    expect(script.match(/Add-DnsClientNrptRule/g)).toHaveLength(2);
    expect(script).toContain(
      `Add-DnsClientNrptRule -Namespace '.corp.example','corp.example' -NameServers '198.18.0.2' -Comment '${RESOLVER_MARK}'`,
    );
    expect(script).not.toContain('Remove-Item');
  });

  it('refuses when Group Policy manages NRPT, since Windows would silently ignore our rules', () => {
    expect(nrptScript(['corp.example'], '198.18.0.2')).toContain('exit 3');
  });

  it('clearing only removes our rules', async () => {
    const scripts: string[] = [];
    await createNrptDns({
      server: '198.18.0.2',
      run: async (script) => void scripts.push(script),
    }).clear();
    expect(scripts[0]).toContain('Remove-DnsClientNrptRule');
    expect(scripts[0]).not.toContain('Add-DnsClientNrptRule');
  });
});
