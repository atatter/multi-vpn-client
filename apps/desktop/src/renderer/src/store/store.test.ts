import type { Config, DockerState } from '@repo/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi, type FakeApi, type Scenario } from './fake-api.ts';
import { type AppView, createAppStore } from './store.ts';

const stops: (() => void)[] = [];
beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

/** Lets pending promises (the fake's answers) settle without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

const ready = (view: AppView) => {
  if (view.phase !== 'ready') throw new Error(`The app isn't ready: ${view.phase}`);
  return view;
};

/** Waits that take (fake) time, for tests that act while main is still busy. */
const timedPause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function start(scenario: Scenario = 'daily', prepare?: (fake: FakeApi) => void, pause?: (ms: number) => Promise<void>) {
  const fake = createFakeApi(pause ? { scenario, pause } : { scenario });
  prepare?.(fake);
  const store = createAppStore(fake.api);
  stops.push(store.start());
  await settle();
  return { fake, store, app: () => ready(store.getState()) };
}

const renamed = (config: Config, vpnId: string, name: string): Config => ({ ...config, vpns: config.vpns.map((vpn) => (vpn.id === vpnId ? { ...vpn, name } : vpn)) });

describe('loading', () => {
  it("shows why the settings couldn't load", async () => {
    const { store } = await start('daily', (fake) => fake.failLoad("The settings file isn't valid JSON."));
    expect(store.getState()).toEqual({ phase: 'failed', error: "The settings file isn't valid JSON." });
  });
});

describe('traffic', () => {
  it("reaches only the traffic views: a new snapshot doesn't re-render the app", async () => {
    const { fake, store, app } = await start();
    const appRenders = vi.fn<() => void>();
    const trafficRenders = vi.fn<() => void>();
    store.subscribe(appRenders);
    app().trafficFeed.subscribe(trafficRenders);
    const snapshot = { rates: { a: [1200] }, destinations: [] };
    fake.sendTraffic(snapshot);
    expect(appRenders).not.toHaveBeenCalled();
    expect(trafficRenders).toHaveBeenCalledOnce();
    expect(app().trafficFeed.get()).toBe(snapshot);
  });
});

describe('saving', () => {
  it("saves in order, and an older save finishing doesn't undo a newer edit", async () => {
    const { fake, app } = await start();
    const releaseOldest = fake.holdSaves();
    const firstSaved = app().save(renamed(app().config, 'a', 'Client A1'));
    const secondSaved = app().save(renamed(app().config, 'a', 'Client A2'));
    expect(app().config.vpns[0]?.name).toBe('Client A2');

    await settle();
    releaseOldest();
    expect(await firstSaved).toBe(true);
    // The second is still saving: the first's answer must not put "Client A1" back on screen.
    expect(app().config.vpns[0]?.name).toBe('Client A2');
    await settle();
    releaseOldest();
    expect(await secondSaved).toBe(true);
    expect(fake.calls.saves.map(({ config }) => config.vpns[0]?.name)).toEqual(['Client A1', 'Client A2']);
    expect(app().config.vpns[0]?.name).toBe('Client A2');
  });

  it("shows why a save was rejected and puts back what's on disk", async () => {
    const { fake, app } = await start();
    fake.rejectNextSave('Another VPN already has that name.');
    expect(await app().save(renamed(app().config, 'a', 'Client B'))).toBe(false);
    expect(app().notice).toBe('Another VPN already has that name.');
    expect(app().config.vpns[0]?.name).toBe('Client A');
  });

  it("doesn't let a rejected save undo a newer one that's still on its way", async () => {
    const { fake, app } = await start();
    const release = fake.holdSaves();
    fake.rejectNextSave('Another VPN already has that name.');
    const rejected = app().save(renamed(app().config, 'a', 'Client B'));
    const accepted = app().save(renamed(app().config, 'a', 'Client A2'));
    await settle();
    release();
    expect(await rejected).toBe(false);
    expect(app().config.vpns[0]?.name).toBe('Client A2');
    release();
    expect(await accepted).toBe(true);
    expect(app().config.vpns[0]?.name).toBe('Client A2');
    expect(fake.config().vpns[0]?.name).toBe('Client A2');
  });

  it("doesn't let a rejected save's reload undo a newer save that finished meanwhile", async () => {
    const { fake, app } = await start();
    fake.rejectNextSave('Another VPN already has that name.');
    const releaseLoad = fake.holdLoads();
    const rejected = app().save(renamed(app().config, 'a', 'Client B'));
    await settle();
    expect(await app().save(renamed(app().config, 'a', 'Client A2'))).toBe(true);
    releaseLoad();
    expect(await rejected).toBe(false);
    expect(app().config.vpns[0]?.name).toBe('Client A2');
  });

  it("takes only the server routes main learned, so a save on its way isn't undone", async () => {
    const { fake, app } = await start();
    const release = fake.holdSaves();
    void app().save(renamed(app().config, 'a', 'Client A1'));
    const learned = { all: false, cidrs: ['10.99.0.0/24'] };
    fake.sendConfigChanged({ ...fake.config(), vpns: fake.config().vpns.map((vpn) => (vpn.id === 'h' ? { ...vpn, serverRoutes: learned } : vpn)) });
    expect(app().config.vpns.find((vpn) => vpn.id === 'a')?.name).toBe('Client A1');
    expect(app().config.vpns.find((vpn) => vpn.id === 'h')?.serverRoutes).toEqual(learned);
    // Main keeps what it learned when the older save lands.
    await settle();
    release();
    await settle();
    expect(fake.config().vpns.find((vpn) => vpn.id === 'h')?.serverRoutes).toEqual(learned);
  });

  it('shows which secrets are stored after a save adds or clears them', async () => {
    const { app } = await start();
    await app().save(app().config, { h: { password: 'hunter2' }, b: { password: null }, a: { password: 'not kept' } });
    expect(app().secretStatus.h).toEqual(['profile', 'password']);
    expect(app().secretStatus.b).toBeUndefined();
    // Client A doesn't remember its password, so main drops it.
    expect(app().secretStatus.a).toBeUndefined();
  });
});

describe('setup', () => {
  it('connects a VPN turned on before Docker and the helper were ready once both are', async () => {
    const { fake, app } = await start('daily', (fake) => {
      fake.setDocker('stopped');
      fake.setHelper('not-installed');
    });
    app().toggle('h');
    await settle();
    expect(app().waiting).toEqual(new Set(['h']));

    fake.setDocker('running');
    await vi.advanceTimersByTimeAsync(3000);
    expect(app().docker).toBe('running');
    expect(fake.calls.connects).toEqual([]);

    expect(await app().runHelper('install')).toBeUndefined();
    await settle();
    expect(app().waiting).toEqual(new Set());
    expect(fake.calls.connects).toEqual([{ vpnId: 'h', password: null }]);
    expect(app().connections.h?.state).toBe('connected');
  });

  it('checks Docker when the user comes back to or clicks in the window, unless a check is running or just answered', async () => {
    const fake = createFakeApi();
    const dockerState = vi.fn<typeof fake.api.dockerState>(fake.api.dockerState);
    const target = new EventTarget();
    const store = createAppStore({ ...fake.api, dockerState });
    stops.push(store.start(target));
    await settle();
    target.dispatchEvent(new Event('focus'));
    expect(dockerState).toHaveBeenCalledOnce();

    fake.setDocker('stopped');
    await vi.advanceTimersByTimeAsync(5000);
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new Event('pointerdown'));
    await settle();
    expect(dockerState).toHaveBeenCalledTimes(2);
    expect(ready(store.getState()).docker).toBe('stopped');
  });

  it("shows Docker running the moment starting it finishes, so its button doesn't flash back", async () => {
    const fake = createFakeApi({ scenario: 'daily', pause: timedPause });
    fake.setDocker('stopped');
    const store = createAppStore({ ...fake.api, dockerState: () => timedPause(100).then(fake.api.dockerState) });
    stops.push(store.start());
    await vi.advanceTimersByTimeAsync(100);
    const app = () => ready(store.getState());
    // What the window shows at the moment the button stops being busy.
    const started = app().startDocker().then(() => ({ dockerStart: app().dockerStart, docker: app().docker }));
    await vi.advanceTimersByTimeAsync(900);
    expect(await started).toEqual({ dockerStart: { starting: false, error: undefined }, docker: 'running' });
  });

  it("shows the newest Docker check's answer, even when an older one answers after it", async () => {
    const fake = createFakeApi();
    const answers: ((docker: DockerState) => void)[] = [];
    const store = createAppStore({ ...fake.api, dockerState: () => new Promise((resolve) => answers.push(resolve)) });
    stops.push(store.start());
    await settle();
    const started = ready(store.getState()).startDocker();
    await settle();
    answers[1]?.('running');
    answers[0]?.('stopped');
    await started;
    expect(ready(store.getState()).docker).toBe('running');
  });

  it('starts Docker once, however many screens ask, and every screen shows it starting', async () => {
    const { fake, app } = await start('daily', (fake) => fake.setDocker('stopped'), timedPause);
    const startDocker = vi.spyOn(fake.api, 'startDocker');
    const first = app().startDocker();
    expect(app().startDocker()).toBe(first);
    expect(app().dockerStart.starting).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    await first;
    expect(startDocker).toHaveBeenCalledOnce();
    expect(app().dockerStart.starting).toBe(false);
  });

  it("keeps a failed start's error for every screen until Docker runs", async () => {
    const fake = createFakeApi();
    fake.setDocker('stopped');
    const store = createAppStore({ ...fake.api, startDocker: async () => ({ ok: false, error: "Docker didn't start within 2 minutes." }) });
    stops.push(store.start());
    await settle();
    await ready(store.getState()).startDocker();
    expect(ready(store.getState()).dockerStart.error).toBe("Docker didn't start within 2 minutes.");
    fake.setDocker('running');
    await vi.advanceTimersByTimeAsync(3000);
    expect(ready(store.getState()).dockerStart.error).toBeUndefined();
  });

  it('drops the error of a start that timed out just as Docker came up', async () => {
    const fake = createFakeApi();
    const store = createAppStore({ ...fake.api, startDocker: async () => ({ ok: false, error: "Docker didn't start within 2 minutes." }) });
    stops.push(store.start());
    await settle();
    await ready(store.getState()).startDocker();
    expect(ready(store.getState()).dockerStart).toEqual({ starting: false, error: undefined });
  });

  it("checks a helper that isn't responding again every 3 seconds", async () => {
    const { fake, app } = await start('daily', (fake) => fake.setHelper('not-responding'));
    expect(app().helper?.state).toBe('not-responding');
    fake.setHelper('ready');
    await vi.advanceTimersByTimeAsync(3000);
    expect(app().helper?.state).toBe('ready');
  });
});

describe('toggle', () => {
  it("connects a VPN that's off and disconnects one that's on", async () => {
    const { fake, app } = await start();
    app().toggle('h');
    app().toggle('a');
    await settle();
    expect(fake.calls.connects).toEqual([{ vpnId: 'h', password: null }]);
    expect(fake.calls.disconnects).toEqual(['a']);
  });

  it("keeps a VPN off when it's turned off while still connecting", async () => {
    const { app } = await start('daily', undefined, timedPause);
    app().toggle('h');
    await settle();
    expect(app().connections.h?.state).toBe('connecting');
    app().toggle('h');
    await vi.advanceTimersByTimeAsync(2000);
    expect(app().connections.h).toBeUndefined();
  });

  it("closes the VPN's open prompt instead of connecting", async () => {
    const { fake, app } = await start();
    app().toggle('c');
    await settle();
    expect(app().prompt).toEqual({ kind: 'password', vpnId: 'c' });
    app().toggle('c');
    expect(app().prompt).toBeUndefined();
    expect(fake.calls.connects).toHaveLength(1);
  });

  it("takes a waiting VPN off the list, so it doesn't connect later", async () => {
    const { fake, app } = await start('daily', (fake) => fake.setDocker('stopped'));
    app().toggle('h');
    await settle();
    app().toggle('h');
    expect(app().waiting).toEqual(new Set());
    fake.setDocker('running');
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.calls.connects).toEqual([]);
  });
});

describe('turnOff', () => {
  it("drops a VPN's wait or prompt, and disconnects it only if it's on", async () => {
    const { fake, app } = await start('daily', (fake) => fake.setDocker('stopped'));
    app().toggle('h');
    await settle();
    await app().turnOff('h');
    expect(app().waiting).toEqual(new Set());

    await app().turnOff('a');
    expect(fake.calls.disconnects).toEqual(['a']);
  });

  it('closes an open prompt without disconnecting', async () => {
    const { fake, app } = await start();
    app().toggle('c');
    await settle();
    await app().turnOff('c');
    expect(app().prompt).toBeUndefined();
    expect(fake.calls.disconnects).toEqual([]);
  });
});

describe('prompts', () => {
  it('remembers the password, then connects with it', async () => {
    const { fake, app } = await start();
    app().toggle('c');
    await settle();
    app().submitPassword('hunter2', true);
    await settle();
    expect(fake.calls.saves).toHaveLength(1);
    expect(fake.calls.saves[0]?.config.vpns.find((vpn) => vpn.id === 'c')?.rememberPassword).toBe(true);
    expect(fake.calls.saves[0]?.secrets).toEqual({ c: { password: 'hunter2' } });
    expect(fake.calls.connects.at(-1)).toEqual({ vpnId: 'c', password: 'hunter2' });
  });

  it('reconnects with the same password after trusting the certificate', async () => {
    const { fake, app } = await start();
    app().toggle('c');
    await settle();
    fake.answerNextConnect({ ok: false, untrustedCertificate: { pin: 'sha256/abc', server: 'sslvpn.client-c.example', changed: false } });
    app().submitPassword('hunter2', false);
    await settle();
    expect(app().prompt).toEqual({ kind: 'certificate', vpnId: 'c', pin: 'sha256/abc', server: 'sslvpn.client-c.example', changed: false, password: 'hunter2' });

    app().trustCertificate();
    await settle();
    expect(fake.calls.connects.at(-1)).toEqual({ vpnId: 'c', password: 'hunter2' });
    expect(app().connections.c?.state).toBe('connected');
  });
});

describe('updating the app', () => {
  it('shows a failed download in the error strip, and drops it once the update moves on', async () => {
    const { fake, app } = await start();
    fake.setUpdate({ state: 'available', version: '0.2.0', size: undefined });
    fake.failNextDownload('HTTP 404.');
    await app().api.downloadUpdate();
    expect(app().notice).toBe("Couldn't download 0.2.0: HTTP 404.");
    expect(app().update).toEqual({ state: 'download-failed', version: '0.2.0', error: 'HTTP 404.' });
    await app().api.downloadUpdate();
    expect(app().notice).toBeUndefined();
    expect(app().update).toEqual({ state: 'ready', version: '0.2.0' });
  });

  it('shows a download that failed before the window opened', async () => {
    const { app } = await start('daily', (fake) => fake.setUpdate({ state: 'download-failed', version: '0.2.0', error: 'HTTP 404.' }));
    expect(app().notice).toBe("Couldn't download 0.2.0: HTTP 404.");
  });

  it('leaves other notices alone', async () => {
    const { app } = await start();
    app().showNotice("That file isn't a VPN profile.");
    await app().api.checkForUpdate();
    expect(app().notice).toBe("That file isn't a VPN profile.");
    expect(app().update).toEqual({ state: 'available', version: '0.2.0', size: 180_000_000 });
  });
});
