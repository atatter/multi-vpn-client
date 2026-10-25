import { describe, expect, it } from 'vitest';
import { createVpnNetwork, dnsFlags } from './start.ts';

describe('dnsFlags', () => {
  it("uses the VPN's configured DNS servers", () => {
    expect(dnsFlags(['10.0.0.53'])).toEqual(['--dns', '10.0.0.53']);
  });

  it("never falls back to Docker's resolver, which would resolve routed domains to placeholders", () => {
    expect(dnsFlags([])).toEqual(['--dns', '1.1.1.1', '--dns', '9.9.9.9']);
  });
});

describe('createVpnNetwork', () => {
  /** A Docker whose `network create` answers from `answers`, one per call, recording each subnet asked for. */
  const docker = (...answers: { code: number; stderr: string }[]) => {
    const subnets: string[] = [];
    return {
      subnets,
      run: async (args: readonly string[]) => {
        subnets.push(args[args.indexOf('--subnet') + 1] ?? '');
        return { stdout: '', ...(answers.shift() ?? { code: 0, stderr: '' }) };
      },
    };
  };
  const overlap = {
    code: 1,
    stderr:
      'Error response from daemon: invalid pool request: Pool overlaps with other one on this address space',
  };

  it('gives each VPN a small network of its own in the reserved block, skipping ranges another network holds', async () => {
    const fake = docker(overlap, overlap);
    await createVpnNetwork(fake, 'mvpn-a');
    expect(fake.subnets).toEqual(['198.18.128.0/28', '198.18.128.16/28', '198.18.128.32/28']);
  });

  it('gives up on any other error, and when every range is taken', async () => {
    await expect(
      createVpnNetwork(docker({ code: 1, stderr: 'permission denied' }), 'mvpn-a'),
    ).rejects.toThrow('permission denied');
    const full = docker(...Array.from({ length: 64 }, () => overlap));
    await expect(createVpnNetwork(full, 'mvpn-a')).rejects.toThrow('no free network');
    expect(full.subnets.at(-1)).toBe('198.18.131.240/28');
  });
});
