import { describe, expect, it } from 'vitest';
import { OPENCONNECT_CARD_IMAGE } from '../../shared/openconnect/container.ts';
import { newVpn } from '../../index.ts';
import { globalProtectCardLaunch, globalProtectLaunch } from './engine.ts';

describe('globalProtectLaunch', () => {
  const vpn = { ...newVpn('globalprotect', { id: 'g', name: 'GP' }), portal: 'portal.example.com', username: 'jane' };

  it('logs in to the portal, reporting the chosen OS, with the password only in a file', () => {
    const launch = globalProtectLaunch({ ...vpn, reportedOs: 'mac', hip: true }, 's3cret');
    expect(launch.command).toEqual([
      'openconnect',
      '--protocol=gp',
      '--user=jane',
      '--usergroup=portal',
      '--os=mac-intel',
      '--csd-wrapper=/usr/libexec/openconnect/hipreport.sh',
      'https://portal.example.com',
    ]);
    expect(launch.files).toEqual({ auth: 's3cret\n' });
  });

  it('goes straight to a chosen gateway, or treats the address as one', () => {
    expect(globalProtectLaunch({ ...vpn, gateway: 'gw1.example.com:8443' }, 'p').command).toContain('https://gw1.example.com:8443');
    expect(globalProtectLaunch({ ...vpn, gateway: 'gw1.example.com:8443' }, 'p').command).toContain('--usergroup=gateway');
    expect(globalProtectLaunch({ ...vpn, connectAs: 'gateway' }, 'p').command).toContain('--usergroup=gateway');
  });

  it('asks to pick a gateway when the portal offers several, listing their addresses', () => {
    const { readLine } = globalProtectLaunch(vpn, 'p');
    readLine('  US East (gw-us.example.com)');
    readLine('  Europe (gw-eu.example.com)');
    expect(readLine('GATEWAY: [US East|Europe]:fgets (stdin): Inappropriate ioctl for device')).toEqual({
      failed: 'The portal offers several gateways: US East (gw-us.example.com), Europe (gw-eu.example.com). Put the address of the one to use in the Gateway field.',
    });
    expect(readLine('Unexpected 512 result from server')).toEqual({ failed: 'The VPN server rejected the username or password.' });
  });

  it('signs in with an ID card: its certificate, no password on stdin, and the empty password as a form entry', () => {
    const card = { ...vpn, username: '', signIn: 'card', connectAs: 'gateway' } as const;
    const launch = globalProtectCardLaunch(card);
    expect(launch.image).toBe(OPENCONNECT_CARD_IMAGE);
    expect(launch.smartCard).toBe('id-card');
    expect(launch.files).toEqual({});
    expect(launch.command).toEqual([
      'openconnect-card',
      'pkcs11:object=Isikutuvastus;type=cert',
      '--protocol=gp',
      '--user=login',
      '--form-entry=_login:passwd=',
      '--usergroup=gateway',
      '--os=win',
      'https://portal.example.com',
    ]);
    const other = globalProtectCardLaunch({ ...card, username: 'jane', cardCertificate: 'pkcs11:id=%02;type=cert' });
    expect(other.smartCard).toBe('any-card');
    expect([launch.signInStep, other.signInStep]).toEqual(['Signing in with your ID card…', 'Signing in with your smart card…']);
    expect(other.command.slice(0, 4)).toEqual(['openconnect-card', 'pkcs11:id=%02;type=cert', '--protocol=gp', '--user=jane']);
    expect(launch.readLine('Unexpected 512 result from server')).toEqual({ failed: "The VPN server didn't accept the card's certificate." });
    const viaPortal = globalProtectCardLaunch({ ...card, connectAs: 'portal' });
    expect(viaPortal.readLine('Valid client certificate is required')).toEqual({
      failed: "The portal didn't accept the card. Under More options, set “Connect to the address as” to “Gateway directly”.",
    });
  });
});
