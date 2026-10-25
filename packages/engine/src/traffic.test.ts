import { describe, expect, it } from 'vitest';
import { createTrafficTally } from './traffic.ts';

const connection = (
  id: string,
  chain: string,
  bytes: number,
  host = '',
  destinationIP = '10.0.0.1',
) => ({
  id,
  upload: bytes / 2,
  download: bytes / 2,
  chains: [chain],
  metadata: { host, destinationIP },
});

describe('createTrafficTally', () => {
  it('counts only what each connection sent since the last poll, per VPN, and leaves direct traffic out', () => {
    const tally = createTrafficTally();
    tally.add([connection('1', 'vpn-a', 1000, 'jira.corp')], ['a', 'b'], 0);
    const snapshot = tally.add(
      [connection('1', 'vpn-a', 1600, 'jira.corp'), connection('2', 'direct', 9000, 'github.com')],
      ['a', 'b'],
      1000,
    );
    expect(snapshot.rates).toEqual({ a: [1000, 600], b: [0, 0] });
    expect(snapshot.destinations).toEqual([
      { host: 'jira.corp', vpnId: 'a', bytes: 1600, last: 1000 },
    ]);
  });

  it("names destinations by host, or by address when there's no name, newest first", () => {
    const tally = createTrafficTally();
    tally.add([connection('1', 'vpn-a', 100, '', '10.140.3.17')], ['a'], 0);
    const snapshot = tally.add(
      [connection('1', 'vpn-a', 100, '', '10.140.3.17'), connection('2', 'vpn-a', 50, 'wiki.corp')],
      ['a'],
      1000,
    );
    expect(snapshot.destinations.map((d) => [d.host, d.last])).toEqual([
      ['wiki.corp', 1000],
      ['10.140.3.17', 0],
    ]);
  });

  it('counts only the last five minutes of a busy host', () => {
    const tally = createTrafficTally();
    tally.add([connection('1', 'vpn-a', 1000, 'jira.corp')], ['a'], 0);
    tally.add([connection('1', 'vpn-a', 1500, 'jira.corp')], ['a'], 4 * 60_000);
    const snapshot = tally.add([connection('1', 'vpn-a', 1700, 'jira.corp')], ['a'], 6 * 60_000);
    expect(snapshot.destinations).toEqual([
      { host: 'jira.corp', vpnId: 'a', bytes: 700, last: 6 * 60_000 },
    ]);
  });

  it('keeps a minute of rates and five minutes of destinations, and forgets disconnected VPNs', () => {
    const tally = createTrafficTally();
    tally.add([connection('1', 'vpn-a', 10, 'old.corp')], ['a'], 0);
    let snapshot = tally.add([], ['a'], 1000);
    for (let second = 2; second <= 70; second++) snapshot = tally.add([], ['a'], second * 1000);
    expect(snapshot.rates.a).toHaveLength(60);
    snapshot = tally.add([], ['a'], 5 * 60_000 + 1);
    expect(snapshot.destinations).toEqual([]);
    expect(tally.add([], [], 6 * 60_000).rates).toEqual({});
  });
});
