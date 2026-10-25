// Node-only: runs VPN containers and talks to the installed network helper.
export { helperLogHint } from './helper-install/index.ts';
export { createConnectionManager, type ConnectionManager } from './manager/connection-manager.ts';
export { detectVpn } from './detect.ts';
export { dockerState, startDocker } from './docker.ts';
