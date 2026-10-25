import { describe, expect, it } from 'vitest';
import { detectVpn, splitAddress } from './detect.ts';
import type { Probe } from '@repo/vpn-sdk/engine';

/** A fake network: answers per "host:port path", nothing elsewhere. */
const network =
  (answers: Record<string, { status?: number; location?: string; body?: string }>): Probe =>
  async ({ host, port, path }) => {
    const answer = answers[`${host}:${port} ${path.split('?')[0]}`];
    return answer
      ? { status: answer.status ?? 200, location: answer.location ?? '', body: answer.body ?? '' }
      : undefined;
  };

describe('detectVpn', () => {
  it('recognises a GlobalProtect portal, and whether it signs in in the browser', async () => {
    const probe = network({
      'vpn.a:443 /global-protect/prelogin.esp': {
        body: '<prelogin-response><status>Success</status><saml-auth-method>REDIRECT</saml-auth-method></prelogin-response>',
      },
    });
    expect(await detectVpn('vpn.a', probe)).toEqual({
      kind: 'globalprotect',
      address: 'vpn.a',
      browserSignIn: true,
    });
  });

  it('recognises a GlobalProtect gateway that only answers on the gateway path', async () => {
    const probe = network({
      'gw.a:443 /ssl-vpn/prelogin.esp': {
        body: "<?xml version='1.0'?><prelogin-response><status>Success</status></prelogin-response>",
      },
    });
    expect(await detectVpn('gw.a', probe)).toEqual({
      kind: 'globalprotect',
      address: 'gw.a',
      browserSignIn: false,
    });
  });

  it('recognises a Check Point gateway from its answer to the client hello', async () => {
    const probe = network({
      'remote.b:443 /clients/': {
        body: '(CCCserverResponse\n\t:ResponseHeader (:id (1) :type (ClientHello) :return_code (600))',
      },
    });
    expect(await detectVpn('remote.b', probe)).toEqual({ kind: 'checkpoint', address: 'remote.b' });
  });

  it('finds a FortiGate on 10443 when no port is given, and keeps the port', async () => {
    const probe = network({
      'sslvpn.c:10443 /remote/login': { body: '<form action="/remote/logincheck" method="post">' },
    });
    expect(await detectVpn('sslvpn.c', probe)).toEqual({
      kind: 'fortinet-ssl',
      address: 'sslvpn.c:10443',
    });
  });

  it("only tries the port given, and follows a FortiGate's redirect to its login page", async () => {
    const probe = network({
      'sslvpn.c:8443 /remote/login': { status: 302, location: '/remote/login?lang=en' },
    });
    expect(await detectVpn('sslvpn.c:8443', probe)).toEqual({
      kind: 'fortinet-ssl',
      address: 'sslvpn.c:8443',
    });
    expect(await detectVpn('sslvpn.c:9443', probe)).toEqual({ kind: 'unknown' });
  });

  it('picks the first kind in VPN_KINDS order when several recognise the address', async () => {
    const probe = network({
      'both.d:443 /global-protect/prelogin.esp': {
        body: '<prelogin-response><status>Success</status></prelogin-response>',
      },
      'both.d:443 /remote/login': { body: '<form action="/remote/logincheck" method="post">' },
    });
    expect(await detectVpn('both.d', probe)).toEqual({ kind: 'fortinet-ssl', address: 'both.d' });
  });

  it('says unknown when nothing answers like a VPN', async () => {
    const probe = network({
      'example.org:443 /remote/login': { status: 404, body: 'Not found' },
      'example.org:443 /clients/': { body: '<html>' },
    });
    expect(await detectVpn('example.org', probe)).toEqual({ kind: 'unknown' });
  });
});

describe('splitAddress', () => {
  it('splits host and port, defaulting to 443', () => {
    expect(splitAddress(' vpn.a:10443 ')).toEqual({
      host: 'vpn.a',
      port: 10443,
      explicitPort: true,
    });
    expect(splitAddress('vpn.a')).toEqual({ host: 'vpn.a', port: 443, explicitPort: false });
  });
});
