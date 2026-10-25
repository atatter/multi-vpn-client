import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ipv6Network, localIpv6Networks } from './local-ipv6.ts';

const iface = (address: string, cidr: string, family: 'IPv4' | 'IPv6' = 'IPv6', internal = false) =>
  ({ address, cidr, internal, family, netmask: '', mac: '', scopeid: 0 }) as NetworkInterfaceInfo;

describe('ipv6Network', () => {
  it('clears the host bits', () => {
    expect(ipv6Network('2001:db8:1:2:aaaa:bbbb:cccc:dddd/64')).toBe('2001:db8:1:2:0:0:0:0/64');
    expect(ipv6Network('2001:db8::5/48')).toBe('2001:db8:0:0:0:0:0:0/48');
    expect(ipv6Network('fd00:1::ffff/127')).toBe('fd00:1:0:0:0:0:0:fffe/127');
    expect(ipv6Network('::1/128')).toBe('0:0:0:0:0:0:0:1/128');
  });

  it("refuses what isn't a plain IPv6 prefix", () => {
    expect(ipv6Network('::ffff:192.0.2.1/96')).toBeUndefined();
    expect(ipv6Network('2001:db8::/129')).toBeUndefined();
    expect(ipv6Network('2001:db8::1::2/64')).toBeUndefined();
    expect(ipv6Network('1:2:3:4:5:6:7:8:9/64')).toBeUndefined();
    expect(ipv6Network('2001:db8::')).toBeUndefined();
  });
});

describe('localIpv6Networks', () => {
  it('lists the subnets of external IPv6 addresses, once each, without link-local ones', () => {
    expect(
      localIpv6Networks({
        lo: [iface('::1', '::1/128', 'IPv6', true)],
        en0: [
          iface('192.168.1.23', '192.168.1.23/24', 'IPv4'),
          iface('fe80::1', 'fe80::1/64'),
          iface('2001:db8:1:2::5', '2001:db8:1:2::5/64'),
          iface('2001:db8:1:2::6', '2001:db8:1:2::6/64'),
          iface('fd00:aa::7', 'fd00:aa::7/64'),
        ],
      }),
    ).toEqual(['2001:db8:1:2:0:0:0:0/64', 'fd00:aa:0:0:0:0:0:0/64']);
  });
});
