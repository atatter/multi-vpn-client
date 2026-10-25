import { describe, expect, it } from 'vitest';
import { createFakeApi, type FakeApi } from './fake-api.ts';

/** Which VPN carries a site, by the fake's "Site not loading?" check; null for the normal connection. */
const carrier = async (fake: FakeApi, site: string) => {
  const answer = await fake.api.checkRoute(site);
  return 'vpnId' in answer ? answer.vpnId : undefined;
};

// The harness and the store's tests trust the fake to route like main; these pin where it could drift.
describe("the fake main process's route check", () => {
  it('follows priority between connected VPNs', async () => {
    const fake = createFakeApi({ scenario: 'overlap' });
    expect(await carrier(fake, '10.141.0.11')).toBe('e');
    await fake.api.saveConfig({ ...fake.config(), priority: ['h', 'e', 'b'] }, {});
    expect(await carrier(fake, '10.141.0.11')).toBe('h');
  });

  it('keeps what main keeps off every tunnel off them too', async () => {
    const fake = createFakeApi({ scenario: 'daily' });
    expect(await carrier(fake, '198.18.0.1')).toBeNull();
  });
});
