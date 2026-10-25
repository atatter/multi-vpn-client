import { ipcMain } from 'electron';
import type { HelperActionResult, IpcChannel, IpcContract } from '../../shared/ipc-contract.ts';

/** Renderer payloads arrive as `unknown`; each handler must parse what it uses. */
type Untrusted<Args extends unknown[]> = { [I in keyof Args]: unknown };

/** Registers a handler for one channel of the IPC contract. The only place main listens to the renderer. */
export function handle<C extends IpcChannel>(
  channel: C,
  handler: (...args: Untrusted<IpcContract[C]['args']>) => Promise<IpcContract[C]['result']>,
) {
  ipcMain.handle(channel, (_event, ...args: unknown[]) =>
    handler(...(args as Untrusted<IpcContract[C]['args']>)),
  );
}

/** Runs a setup action and reports its error as a result instead of a rejection. */
export const asAction = (action: () => Promise<void>): Promise<HelperActionResult> =>
  action().then(
    () => ({ ok: true }),
    (error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
