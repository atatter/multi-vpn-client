import { describe, expect, it } from 'vitest';
import { intersect, isIpv4, networkOf, parseCidr, rangesToCidrs, subtract, union } from './cidr.ts';

const range = (cidr: string) => {
  const parsed = parseCidr(cidr);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.range;
};

describe('parseCidr', () => {
  it('parses a network address', () => {
    expect(parseCidr('10.20.0.0/16')).toEqual({
      ok: true,
      cidr: '10.20.0.0/16',
      range: [0x0a140000, 0x0a14ffff],
    });
  });

  it('treats a bare address as /32', () => {
    expect(parseCidr('10.1.2.3')).toMatchObject({ ok: true, cidr: '10.1.2.3/32' });
  });

  it('handles the full IPv4 space', () => {
    expect(parseCidr('0.0.0.0/0')).toMatchObject({ ok: true, range: [0, 0xffffffff] });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseCidr(' 10.0.0.0/8 ')).toMatchObject({ ok: true, cidr: '10.0.0.0/8' });
  });

  it('rejects host bits and suggests the network address', () => {
    expect(parseCidr('10.20.1.5/16')).toEqual({
      ok: false,
      error: 'Host bits are set. Did you mean 10.20.0.0/16?',
    });
  });

  it.each([
    '',
    '10.0.0',
    '10.0.0.256/8',
    '10.0.0.0/33',
    '10.0.0.0/',
    '01.0.0.0/8',
    'a.b.c.d/8',
    '::1/128',
  ])('rejects %j', (input) => {
    expect(parseCidr(input).ok).toBe(false);
  });
});

describe('range set operations', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(union([range('10.0.0.128/25'), range('10.0.0.0/25'), range('10.0.0.64/26')])).toEqual([
      range('10.0.0.0/24'),
    ]);
  });

  it('subtracts a hole from the middle', () => {
    expect(subtract([range('10.0.0.0/24')], [range('10.0.0.64/26')])).toEqual([
      [0x0a000000, 0x0a00003f],
      [0x0a000080, 0x0a0000ff],
    ]);
  });

  it('subtracting everything leaves nothing', () => {
    expect(subtract([range('10.20.0.0/16')], [range('10.0.0.0/8')])).toEqual([]);
  });

  it('intersects', () => {
    expect(intersect([range('10.0.0.0/8')], [range('10.20.0.0/16'), range('11.0.0.0/8')])).toEqual([
      range('10.20.0.0/16'),
    ]);
  });
});

describe('rangesToCidrs', () => {
  it('splits a /8 minus a /16 into the minimal prefix set', () => {
    const remainder = subtract([range('10.0.0.0/8')], [range('10.20.0.0/16')]);
    expect(rangesToCidrs(remainder)).toEqual([
      '10.0.0.0/12',
      '10.16.0.0/14',
      '10.21.0.0/16',
      '10.22.0.0/15',
      '10.24.0.0/13',
      '10.32.0.0/11',
      '10.64.0.0/10',
      '10.128.0.0/9',
    ]);
  });

  it('emits the whole space as /0', () => {
    expect(rangesToCidrs([range('0.0.0.0/0')])).toEqual(['0.0.0.0/0']);
  });

  it('covers an unaligned range exactly', () => {
    expect(rangesToCidrs([[0x0a000001, 0x0a000006]])).toEqual([
      '10.0.0.1/32',
      '10.0.0.2/31',
      '10.0.0.4/31',
      '10.0.0.6/32',
    ]);
  });
});

describe('networkOf', () => {
  it('zeroes host bits of an interface address', () => {
    expect(networkOf('192.168.1.23/24')).toBe('192.168.1.0/24');
    expect(networkOf('10.0.0.1/0')).toBe('0.0.0.0/0');
  });

  it.each(['fe80::1/64', '10.0.0.1/40', '10.8.0.2/', '10.8.0.2/1e1', '10.8.0.2/0x10', '10.8.0.2'])(
    'returns undefined for %j',
    (input) => {
      expect(networkOf(input)).toBeUndefined();
    },
  );
});

describe('isIpv4', () => {
  it('accepts plain dotted quads only', () => {
    expect(isIpv4('10.0.0.53')).toBe(true);
    expect(isIpv4('10.0.0.0/8')).toBe(false);
    expect(isIpv4('2606:4700::1111')).toBe(false);
    expect(isIpv4('dns.example')).toBe(false);
  });
});
