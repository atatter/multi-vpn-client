import type { Updater } from '../updater.ts';
import { handle } from './handle.ts';

/** Updating the app: none of these take arguments, and the state follows as "update:changed" events. */
export function registerUpdateHandlers({ updater, restart }: { updater: Updater; restart: () => void }) {
  handle('update:state', async () => updater.state());
  handle('update:check', updater.check);
  handle('update:download', updater.download);
  handle('update:restart', async () => restart());
}
