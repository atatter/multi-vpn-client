import { describe, expect, it } from 'vitest';
import {
  Config,
  emptyConfig,
  isBroad,
  keepServerRoutes,
  parseSite,
  normalizeDomain,
  placeVpn,
  rankVpns,
  retarget,
  routeTarget,
  settleVpn,
  type RouteRule,
} from './config.ts';
import { changeKind, newVpn, Vpn, VPN_KINDS, vpnHosts, type VpnOf } from '@repo/vpns';

const fortinet: VpnOf<'fortinet-ssl'> = {
  ...newVpn('fortinet-ssl', { id: 'a', name: 'Client A' }),
  gateway: 'sslvpn.client-a.example:10443',
  username: 'jane',
};

const valid = {
  version: 1,
  vpns: [fortinet],
  routes: [
    {
      id: 'r1',
      kind: 'cidr',
      cidr: '10.20.0.0/16',
      vpnId: 'a',
      enabled: true,
      note: '',
      pinned: false,
    },
  ],
  priority: ['a'],
};

const issues = (input: unknown) => {
  const result = Config.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('Config', () => {
  it('accepts a valid config', () => {
    expect(Config.parse(valid)).toEqual(valid);
  });

  it('accepts the empty config', () => {
    expect(Config.parse(emptyConfig())).toEqual({ version: 1, vpns: [], routes: [], priority: [] });
  });

  it('stores route CIDRs in canonical form', () => {
    const parsed = Config.parse({ ...valid, routes: [{ ...valid.routes[0], cidr: ' 10.0.0.5 ' }] });
    expect(parsed.routes[0]).toMatchObject({ kind: 'cidr', cidr: '10.0.0.5/32' });
  });

  it('loads routes saved before domain routes existed as CIDR routes', () => {
    const legacy = {
      ...valid,
      routes: [{ id: 'r1', cidr: '10.20.0.0/16', vpnId: 'a', enabled: true, note: '' }],
    };
    expect(Config.parse(legacy).routes[0]).toEqual(valid.routes[0]);
  });

  it('accepts domain routes and stores them normalized', () => {
    const parsed = Config.parse({
      ...valid,
      routes: [
        {
          id: 'r1',
          kind: 'domain',
          domain: 'https://Argo.Lab.example/login',
          vpnId: 'a',
          enabled: true,
          note: '',
        },
      ],
    });
    expect(parsed.routes[0]).toMatchObject({ kind: 'domain', domain: 'argo.lab.example' });
  });

  it('rejects an invalid domain route', () => {
    expect(
      issues({
        ...valid,
        routes: [
          { id: 'r1', kind: 'domain', domain: 'not a domain', vpnId: 'a', enabled: true, note: '' },
        ],
      }),
    ).toEqual(['routes.0.domain: Expected a domain, e.g. corp.example']);
  });

  it('rejects a route with host bits set', () => {
    expect(issues({ ...valid, routes: [{ ...valid.routes[0], cidr: '10.20.1.5/16' }] })).toEqual([
      'routes.0.cidr: Host bits are set. Did you mean 10.20.0.0/16?',
    ]);
  });

  it('rejects a route that points at a missing VPN', () => {
    expect(issues({ ...valid, routes: [{ ...valid.routes[0], vpnId: 'ghost' }] })).toEqual([
      'routes.0.vpnId: Route points at unknown VPN "ghost"',
    ]);
  });

  it('rejects duplicate ids', () => {
    expect(issues({ ...valid, vpns: [fortinet, fortinet] })).toEqual([
      'vpns.1.id: Duplicate VPN id "a"',
    ]);
  });

  it('rejects unknown VPN kinds', () => {
    expect(issues({ ...valid, vpns: [{ ...fortinet, kind: 'pptp' }] })).toHaveLength(1);
  });
});

describe('Vpn', () => {
  const fieldIssues = (vpn: unknown) => {
    const result = Vpn.safeParse(vpn);
    return result.success
      ? {}
      : Object.fromEntries(
          result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
        );
  };

  it('new VPNs of every kind start incomplete, not broken', () => {
    for (const kind of VPN_KINDS) {
      const vpn = newVpn(kind, { id: 'x', name: 'X' });
      expect(vpn.kind).toBe(kind);
      expect(Object.keys(fieldIssues(vpn)).length).toBeGreaterThan(0);
    }
  });

  it('rejects URLs where a host is expected', () => {
    const gp = {
      ...newVpn('globalprotect', { id: 'g', name: 'G' }),
      portal: 'https://vpn.example.com',
    };
    expect(fieldIssues(gp).portal).toBe(
      'Enter a host name or IP, e.g. vpn.example.com (no https://)',
    );
  });

  it("takes a PKCS#11 URI for a GlobalProtect card's certificate, and defaults older configs to password sign-in", () => {
    const gp = {
      ...newVpn('globalprotect', { id: 'g', name: 'G' }),
      portal: 'vpn.example.com',
      signIn: 'card' as const,
    };
    expect(fieldIssues({ ...gp, cardCertificate: 'pkcs11:id=%02;type=cert' })).toEqual({});
    expect(fieldIssues({ ...gp, cardCertificate: 'Isikutuvastus' }).cardCertificate).toMatch(
      /^Expected a PKCS#11 URI/,
    );
    const { signIn: _signIn, cardCertificate: _cardCertificate, ...older } = gp;
    expect(Vpn.parse(older)).toMatchObject({ signIn: 'password', cardCertificate: '' });
  });

  it('validates DNS servers and domains', () => {
    expect(
      fieldIssues({
        ...fortinet,
        dns: { servers: ['10.0.0.53', 'dns.example'], domains: ['corp.example', 'bad domain'] },
      }),
    ).toEqual({
      'dns.servers.1': 'Expected an IPv4 address',
      'dns.domains.1': 'Expected a domain, e.g. corp.example',
    });
  });

  it('accepts a complete Check Point VPN', () => {
    const checkpoint = {
      ...newVpn('checkpoint', { id: 'c', name: 'C' }),
      server: 'remote.client-c.example',
      loginType: 'vpn_EntraID',
    };
    expect(fieldIssues(checkpoint)).toEqual({});
  });
});

describe('changeKind', () => {
  it('keeps shared settings and resets type-specific ones', () => {
    const changed = changeKind(
      { ...fortinet, dns: { servers: ['10.0.0.53'], domains: [] }, advanced: 'MTU = 1380' },
      'checkpoint',
    );
    expect(changed).toEqual({
      ...newVpn('checkpoint', { id: 'a', name: 'Client A' }),
      dns: { servers: ['10.0.0.53'], domains: [] },
      advanced: 'MTU = 1380',
    });
  });
});

describe('vpnHosts', () => {
  it('returns the hosts each kind connects to, without ports', () => {
    expect(vpnHosts(fortinet)).toEqual(['sslvpn.client-a.example']);
    expect(
      vpnHosts({
        ...newVpn('globalprotect', { id: 'g', name: 'G' }),
        portal: 'portal.example',
        gateway: 'gw1.example:8443',
      }),
    ).toEqual(['portal.example', 'gw1.example']);
    expect(
      vpnHosts({
        ...newVpn('openvpn', { id: 'o', name: 'O' }),
        remotes: ['a.example:1194', 'b.example:443'],
      }),
    ).toEqual(['a.example', 'b.example']);
    expect(vpnHosts(newVpn('checkpoint', { id: 'c', name: 'C' }))).toEqual([]);
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['argo.lab.example', 'argo.lab.example'],
    ['  Argo.Lab.EXAMPLE. ', 'argo.lab.example'],
    ['*.lab.example', 'lab.example'],
    ['.lab.example', 'lab.example'],
    ['https://argo.lab.example:8443/path?q=1', 'argo.lab.example'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe('retarget', () => {
  const route: RouteRule = {
    id: 'r',
    kind: 'cidr',
    cidr: '',
    vpnId: 'a',
    enabled: true,
    note: 'n',
    pinned: false,
  };

  it('treats digits, dots and slashes as an IP range and anything else as a domain', () => {
    expect(retarget(route, '10.20.0.0/16')).toEqual({
      ...route,
      kind: 'cidr',
      cidr: '10.20.0.0/16',
    });
    expect(retarget(route, 'argo.lab.example')).toEqual({
      id: 'r',
      kind: 'domain',
      domain: 'argo.lab.example',
      vpnId: 'a',
      enabled: true,
      note: 'n',
      pinned: false,
    });
    expect(routeTarget(retarget(route, 'argo.lab.example'))).toBe('argo.lab.example');
  });
});

describe('traffic and priority', () => {
  const vpn = (
    id: string,
    traffic: Vpn['traffic'] = 'sites',
    serverRoutes: Vpn['serverRoutes'] = null,
  ): Vpn => ({
    ...newVpn('openvpn', { id, name: id.toUpperCase() }),
    remotes: ['vpn.example.com'],
    traffic,
    serverRoutes,
  });

  it('loads VPNs saved before traffic modes existed as choosing their own sites, with nothing learned yet', () => {
    const { traffic: _traffic, serverRoutes: _serverRoutes, ...legacy } = fortinet;
    const parsed = Config.parse({ version: 1, vpns: [legacy], routes: [] });
    expect(parsed.vpns[0]).toMatchObject({ traffic: 'sites', serverRoutes: null });
    expect(parsed.priority).toEqual([]);
  });

  it("starts new VPNs on the official app's routes", () => {
    expect(newVpn('globalprotect', { id: 'x', name: 'X' })).toMatchObject({
      traffic: 'official',
      serverRoutes: null,
    });
  });

  it('knows which VPNs carry everything', () => {
    expect(isBroad(vpn('a', 'all'))).toBe(true);
    expect(isBroad(vpn('a', 'official', { all: true, cidrs: [] }))).toBe(true);
    expect(isBroad(vpn('a', 'official', { all: false, cidrs: ['10.0.0.0/8'] }))).toBe(false);
    expect(isBroad(vpn('a', 'official'))).toBe(false); // not known yet
    expect(isBroad(vpn('a', 'sites', { all: true, cidrs: [] }))).toBe(false);
  });

  it('drops removed VPNs and duplicates from the priority when saving', () => {
    expect(
      Config.parse({
        version: 1,
        vpns: [vpn('a'), vpn('b')],
        routes: [],
        priority: ['b', 'ghost', 'b', 'a'],
      }).priority,
    ).toEqual(['b', 'a']);
  });

  it('ranks unplaced VPNs by kind: own-network ones first, all-traffic ones last', () => {
    const config = { vpns: [vpn('broad', 'all'), vpn('a'), vpn('b'), vpn('c')], priority: ['c'] };
    expect(rankVpns(config).map((v) => v.id)).toEqual(['a', 'b', 'c', 'broad']);
  });

  it('moves a VPN above or below another, and settles it back by kind', () => {
    const config = {
      vpns: [vpn('a'), vpn('b'), vpn('broad', 'all')],
      priority: ['a', 'b', 'broad'],
    };
    expect(placeVpn(config, 'broad', 'a', 'above')).toEqual(['broad', 'a', 'b']);
    expect(placeVpn(config, 'a', 'b', 'below')).toEqual(['b', 'a', 'broad']);
    expect(placeVpn(config, 'a', 'ghost', 'above')).toEqual(config.priority);
    expect(settleVpn({ ...config, priority: ['broad', 'a', 'b'] }, 'broad')).toEqual([
      'a',
      'b',
      'broad',
    ]);
    expect(settleVpn(config, 'b')).toEqual(['b', 'a', 'broad']);
  });

  it('keeps the traffic mode but forgets what the old server sent when the kind changes', () => {
    const changed = changeKind(vpn('a', 'all', { all: true, cidrs: [] }), 'fortinet-ssl');
    expect(changed).toMatchObject({ kind: 'fortinet-ssl', traffic: 'all', serverRoutes: null });
  });

  it('loads routes saved before pins existed as unpinned', () => {
    const { pinned: _pinned, ...legacy } = valid.routes[0]!;
    expect(Config.parse({ ...valid, routes: [legacy] }).routes[0]).toMatchObject({ pinned: false });
  });
});

describe('keepServerRoutes', () => {
  const learned = { all: false, cidrs: ['10.140.0.0/16'] };
  const fortinet = {
    ...newVpn('fortinet-ssl', { id: 'f', name: 'F' }),
    gateway: 'vpn.example.com',
    serverRoutes: learned,
  };

  it('keeps what the server sent across saves from the window, whatever the window sent', () => {
    expect(
      keepServerRoutes([fortinet], [{ ...fortinet, name: 'Renamed', serverRoutes: null }])[0]
        ?.serverRoutes,
    ).toEqual(learned);
    expect(
      keepServerRoutes([fortinet], [{ ...fortinet, serverRoutes: { all: true, cidrs: [] } }])[0]
        ?.serverRoutes,
    ).toEqual(learned);
  });

  it('forgets it when the VPN connects somewhere else, and starts new VPNs without it', () => {
    expect(
      keepServerRoutes([fortinet], [{ ...fortinet, gateway: 'other.example.com' }])[0]
        ?.serverRoutes,
    ).toBeNull();
    expect(keepServerRoutes([], [fortinet])[0]?.serverRoutes).toBeNull();
  });
});

describe('changeKind to Check Point', () => {
  it("moves the official app's routes to chosen sites, since Check Point can't say what it sends", () => {
    expect(changeKind(newVpn('globalprotect', { id: 'g', name: 'G' }), 'checkpoint').traffic).toBe(
      'sites',
    );
  });
});

describe('parseSite', () => {
  it('keeps only the site of a pasted link, and tells addresses from names', () => {
    expect(parseSite('https://Jira.Client-C.example/browse/ABC-12?x=1')).toEqual({
      site: 'jira.client-c.example',
      isAddress: false,
    });
    expect(parseSite(' 10.140.3.17 ')).toEqual({ site: '10.140.3.17', isAddress: true });
    expect(parseSite('http://10.140.3.17:8080/')).toEqual({ site: '10.140.3.17', isAddress: true });
  });

  it("refuses what isn't a site", () => {
    expect(parseSite('localhost')).toBeUndefined();
    expect(parseSite('not a site')).toBeUndefined();
    expect(parseSite('')).toBeUndefined();
  });
});
