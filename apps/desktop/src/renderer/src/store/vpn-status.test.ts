import { routingPlan } from '@repo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedIds, onIds } from '../domain/connection.ts';
import type { AppModel } from './app-model.ts';
import { createFakeApi, type Scenario } from './fake-api.ts';
import { createAppStore } from './store.ts';
import { statusOf, switchLook } from './vpn-status.ts';

const stops: (() => void)[] = [];
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

/** The app as a screen sees it, for a scenario of the fake main process. */
async function appFor(
  scenario: Scenario,
  prepare?: (fake: ReturnType<typeof createFakeApi>) => void,
): Promise<AppModel> {
  const fake = createFakeApi({ scenario });
  prepare?.(fake);
  const store = createAppStore(fake.api);
  stops.push(store.start());
  await vi.advanceTimersByTimeAsync(0);
  const view = store.getState();
  if (view.phase !== 'ready') {
    throw new Error(`The app isn't ready: ${view.phase}`);
  }

  return { ...view, push: () => {}, back: () => {}, home: () => {} };
}

const layerOf = (app: AppModel, vpnId: string) =>
  routingPlan(
    app.config,
    onIds(app.connections, app.prompt, app.waiting),
    connectedIds(app.connections),
  ).find((layer) => layer.vpnId === vpnId);

describe("a row's status line", () => {
  it('says what an all-traffic VPN under another one still carries', async () => {
    const app = await appFor('daily');
    const vpn = app.config.vpns.find((candidate) => candidate.id === 'a');
    if (!vpn) {
      throw new Error('no Client A');
    }

    expect(statusOf(vpn, app, layerOf(app, 'a'))).toMatchObject({
      text: 'Everything else',
      tone: 'go',
      rate: true,
    });
  });

  it('describes an idle VPN by what it carries and its account', async () => {
    const app = await appFor('daily');
    const vpn = app.config.vpns.find((candidate) => candidate.id === 'c');
    if (!vpn) {
      throw new Error('no Client C');
    }

    expect(statusOf(vpn, app, undefined)).toMatchObject({
      scope: 'Chosen sites',
      text: ' · jane',
      tone: 'muted',
    });
  });

  it("names what's missing for a VPN that can't connect yet, so it stands out", async () => {
    const app = await appFor('daily');
    const vpn = app.config.vpns.find((candidate) => candidate.id === 'h');
    if (!vpn) {
      throw new Error('no Home OpenVPN');
    }

    expect(statusOf(vpn, { ...app, secretStatus: {} }, undefined)).toEqual({
      text: 'Needs the .ovpn profile',
      tone: 'sodium',
    });
  });

  it('shows a failed connect in red, with the first line of its message', async () => {
    const app = await appFor('broke');
    const vpn = app.config.vpns.find((candidate) => candidate.id === 'c');
    if (!vpn) {
      throw new Error('no Client C');
    }

    expect(statusOf(vpn, app, undefined)).toMatchObject({
      text: 'The VPN server rejected the username or password.',
      tone: 'danger',
    });
    expect(switchLook('c', app, undefined)).toEqual({ on: true, tone: 'error' });
  });
});
