import { dockerState, helperLogHint, startDocker, type ConnectionManager } from '@repo/engine';
import { asAction, handle } from './handle.ts';

/** What connecting needs: Docker running and the network helper installed. */
export function registerSetupHandlers({ connections }: { connections: ConnectionManager }) {
  handle('docker:state', dockerState);
  handle('docker:start', () => asAction(startDocker));
  handle('helper:state', async () => ({ state: await connections.helperState(), logHint: helperLogHint() }));
  handle('helper:install', () => asAction(connections.installHelper));
  handle('helper:uninstall', () => asAction(connections.uninstallHelper));
}
