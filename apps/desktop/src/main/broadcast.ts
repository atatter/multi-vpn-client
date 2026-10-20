import { BrowserWindow } from "electron";
import type { IpcEvents } from "../shared/ipc-contract.ts";

/** Pushes an event to every window. */
export function broadcast<E extends keyof IpcEvents>(event: E, payload: IpcEvents[E]) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(event, payload);
}
