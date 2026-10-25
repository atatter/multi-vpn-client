import type { TrafficSnapshot } from '@repo/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/src/app/App.tsx';
import { createFakeApi, HOSTS, SCENARIOS } from '../src/renderer/src/store/fake-api.ts';
import { UPDATES } from '../src/renderer/src/store/fake-update.ts';
import { createAppStore } from '../src/renderer/src/store/store.ts';
import './styles.css';

/**
 * The real renderer over the fake main process, in a browser. Pick a scenario with the URL hash
 * (#first, #daily, #overlap, #shared, #broke) and an update state with ?update= (a key of UPDATES, e.g.
 * ?update=ready#daily). Waits take real time, connected VPNs carry made-up traffic, and `window.fake` holds the
 * fake's controls (e.g. `fake.failNextConnect("…")`, `fake.setUpdate(UPDATES.available)`).
 */
const hash = location.hash.slice(1);
const updateName = new URLSearchParams(location.search).get('update');
const fake = createFakeApi({
  scenario: SCENARIOS.find((name) => name === hash) ?? 'daily',
  update: Object.entries(UPDATES).find(([name]) => name === updateName)?.[1] ?? UPDATES.idle,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
Object.assign(window, { fake, UPDATES });

// The frame around the window (index.html) sizes it, as main sizes the real window.
const store = createAppStore({
  ...fake.api,
  fitWindow: async (height) => window.parent.postMessage({ fit: height }, '*'),
});
store.start(window);

// About a second of traffic at a time for each connected VPN, to its usual hosts.
const rates: TrafficSnapshot['rates'] = {};
const destinations = new Map<string, TrafficSnapshot['destinations'][number]>();
function tick() {
  const now = Date.now();
  const live = Object.entries(fake.statuses()).flatMap(([vpnId, status]) =>
    status.state === 'connected' ? [vpnId] : [],
  );
  for (const vpnId of Object.keys(rates)) {
    if (!live.includes(vpnId)) {
      delete rates[vpnId];
    }
  }
  for (const vpnId of live) {
    const bytes = Math.random() < 0.7 ? Math.round(500 * Math.exp(Math.random() * 4.5)) : 0;
    rates[vpnId] = [...(rates[vpnId] ?? []), bytes].slice(-60);
    const hosts = HOSTS[vpnId] ?? ['example.com'];
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    if (!bytes || !host) {
      continue;
    }
    const entry = destinations.get(`${vpnId} ${host}`) ?? { host, vpnId, bytes: 0, last: now };
    destinations.set(`${vpnId} ${host}`, { ...entry, bytes: entry.bytes + bytes, last: now });
  }
  const shown = [...destinations.values()]
    .filter((entry) => live.includes(entry.vpnId))
    .sort((a, b) => b.last - a.last);
  fake.sendTraffic({ rates: { ...rates }, destinations: shown });
}
for (let second = 0; second < 60; second++) {
  tick();
}
setInterval(tick, 1000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
