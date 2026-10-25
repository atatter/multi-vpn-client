import { describe, expect, it } from 'vitest';
import { HelperRequest, parseHelperLine } from './helper-protocol.ts';

const tunnel = {
  vpnId: '0f8b6c1e-6a3e-4d2f-9a51-3f1f0b7c2a10',
  port: 41000,
  username: 'mvpn',
  password: 'abc_DEF-123',
  cidrs: ['10.20.0.0/16'],
  dns: { servers: ['10.20.0.53'], domains: ['corp.example'] },
};

const error = (input: unknown) => {
  const result = HelperRequest.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
};

describe('HelperRequest: stats endpoint', () => {
  it('accepts a loopback stats port and secret, and rejects odd ones', () => {
    const routes = {
      blockIpv6: false,
      tunnels: [tunnel],
      domains: [],
      stats: { port: 45001, secret: 'Xk3_-abc' },
    };
    expect(HelperRequest.parse({ command: 'apply', routes })).toEqual({ command: 'apply', routes });
    expect(
      error({ command: 'apply', routes: { ...routes, stats: { port: 80, secret: 'x' } } }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: { ...routes, stats: { port: 45001, secret: 'has space' } },
      }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: { ...routes, stats: { port: 45001, secret: 'x', host: '0.0.0.0' } },
      }),
    ).toBeDefined();
  });
});

describe('HelperRequest', () => {
  it('accepts status, the handshake, and apply', () => {
    expect(HelperRequest.parse({ command: 'hello', nonce: 'n'.repeat(43) })).toEqual({
      command: 'hello',
      nonce: 'n'.repeat(43),
    });
    expect(HelperRequest.parse({ command: 'auth', proof: 'a'.repeat(64) })).toEqual({
      command: 'auth',
      proof: 'a'.repeat(64),
    });
    expect(error({ command: 'hello', token: 'raw-secret' })).toBeDefined();
    expect(HelperRequest.parse({ command: 'status' })).toEqual({ command: 'status' });
    const routes = {
      blockIpv6: false,
      tunnels: [tunnel],
      domains: [{ vpnId: tunnel.vpnId, domain: 'argo.lab.example' }],
    };
    expect(HelperRequest.parse({ command: 'apply', routes })).toEqual({ command: 'apply', routes });
  });

  it("rejects domain routes for VPNs that aren't connected, and invalid domains", () => {
    expect(
      error({
        command: 'apply',
        routes: {
          blockIpv6: false,
          tunnels: [tunnel],
          domains: [{ vpnId: 'other', domain: 'x.example' }],
        },
      }),
    ).toBe("Domain route for a VPN that isn't connected");
    expect(
      error({
        command: 'apply',
        routes: {
          blockIpv6: false,
          tunnels: [tunnel],
          domains: [{ vpnId: tunnel.vpnId, domain: '../etc' }],
        },
      }),
    ).toBeDefined();
  });

  it("rejects anything that isn't canonical, local or simple", () => {
    expect(
      error({
        command: 'apply',
        routes: {
          blockIpv6: false,
          domains: [],
          tunnels: [{ ...tunnel, cidrs: ['10.20.1.0/16'] }],
        },
      }),
    ).toContain('Host bits');
    expect(
      error({
        command: 'apply',
        routes: { blockIpv6: false, domains: [], tunnels: [{ ...tunnel, cidrs: ['10.20.0.5'] }] },
      }),
    ).toBe('Expected a canonical CIDR like 10.20.0.0/16');
    expect(
      error({
        command: 'apply',
        routes: { blockIpv6: false, domains: [], tunnels: [{ ...tunnel, port: 80 }] },
      }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: { blockIpv6: false, domains: [], tunnels: [{ ...tunnel, password: 'has space' }] },
      }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: { blockIpv6: false, domains: [], tunnels: [{ ...tunnel, vpnId: '../etc' }] },
      }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: {
          blockIpv6: false,
          domains: [],
          tunnels: [{ ...tunnel, dns: { servers: [], domains: ['../../etc/passwd'] } }],
        },
      }),
    ).toBeDefined();
    expect(
      error({
        command: 'apply',
        routes: { blockIpv6: false, domains: [], tunnels: [{ ...tunnel, extra: 'config' }] },
      }),
    ).toBeDefined();
    expect(error({ command: 'run', script: 'rm -rf /' })).toBeDefined();
  });
});

describe('parseHelperLine', () => {
  it('parses one JSON request per line', () => {
    expect(parseHelperLine('{"command":"status"}')).toEqual({
      ok: true,
      request: { command: 'status' },
    });
  });

  it('reports malformed input without throwing', () => {
    expect(parseHelperLine('GET / HTTP/1.1')).toEqual({ ok: false, error: 'Malformed request' });
    expect(parseHelperLine('{"command":"nope"}')).toMatchObject({ ok: false });
  });
});
