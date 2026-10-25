import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcChannel, IpcContract, IpcEvents } from '../shared/ipc-contract.ts';

// Electron types results as `any`; main is the trusted side and its handlers are typed by the same contract.
const invoke = <C extends IpcChannel>(channel: C, ...args: IpcContract[C]['args']) =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcContract[C]['result']>;

/** Subscribes to a main → renderer event; returns the unsubscribe function. */
const on = <E extends keyof IpcEvents>(event: E, listener: (payload: IpcEvents[E]) => void) => {
  const handler = (_event: IpcRendererEvent, payload: IpcEvents[E]) => listener(payload);
  ipcRenderer.on(event, handler);
  return () => {
    ipcRenderer.removeListener(event, handler);
  };
};

/** The only surface the renderer gets: typed calls into the main process. */
const api = {
  loadConfig: () => invoke('config:load'),
  saveConfig: (...args: IpcContract['config:save']['args']) => invoke('config:save', ...args),
  detect: (...args: IpcContract['vpn:detect']['args']) => invoke('vpn:detect', ...args),
  checkRoute: (...args: IpcContract['route:check']['args']) => invoke('route:check', ...args),
  dockerState: () => invoke('docker:state'),
  startDocker: () => invoke('docker:start'),
  connect: (...args: IpcContract['vpn:connect']['args']) => invoke('vpn:connect', ...args),
  disconnect: (...args: IpcContract['vpn:disconnect']['args']) => invoke('vpn:disconnect', ...args),
  connectionStatuses: () => invoke('vpn:statuses'),
  answer: (...args: IpcContract['vpn:answer']['args']) => invoke('vpn:answer', ...args),
  reopenSignIn: (...args: IpcContract['vpn:reopen-sign-in']['args']) =>
    invoke('vpn:reopen-sign-in', ...args),
  runAction: (...args: IpcContract['vpn:action']['args']) => invoke('vpn:action', ...args),
  trustCertificate: (...args: IpcContract['vpn:trust-certificate']['args']) =>
    invoke('vpn:trust-certificate', ...args),
  helperState: () => invoke('helper:state'),
  installHelper: () => invoke('helper:install'),
  uninstallHelper: () => invoke('helper:uninstall'),
  appInfo: () => invoke('app:info'),
  showConfig: () => invoke('app:show-config'),
  fitWindow: (...args: IpcContract['window:fit']['args']) => invoke('window:fit', ...args),
  updateState: () => invoke('update:state'),
  checkForUpdate: () => invoke('update:check'),
  downloadUpdate: () => invoke('update:download'),
  restartToUpdate: () => invoke('update:restart'),
  onConnectionStatus: (listener: (statuses: IpcEvents['vpn:status']) => void) =>
    on('vpn:status', listener),
  onTraffic: (listener: (snapshot: IpcEvents['traffic:update']) => void) =>
    on('traffic:update', listener),
  onConfigChanged: (listener: (config: IpcEvents['config:changed']) => void) =>
    on('config:changed', listener),
  onUpdate: (listener: (state: IpcEvents['update:changed']) => void) =>
    on('update:changed', listener),
};

export type MainApi = typeof api;

contextBridge.exposeInMainWorld('main', api);
