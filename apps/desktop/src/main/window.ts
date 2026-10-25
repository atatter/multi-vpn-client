import { APP_NAME } from '@repo/core';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import type { AppInfo } from '../shared/ipc-contract.ts';

// A small, fixed-width window sized to its content, like other VPN clients.
const WINDOW_WIDTH = 360;
const TITLE_BAR_HEIGHT = 44;
let mainWindow: BrowserWindow | undefined;
/** When the Dock icon last showed or hid: Electron ignores `dock.hide()` within a second of that (see `Dock.hide` in electron.d.ts). */
let dockChangedAt = 0;
let dockHide: ReturnType<typeof setTimeout> | undefined;

/** The app's icon, drawn from resources/icon.svg: the window's on Linux and Windows, the Dock's on macOS. */
export const APP_ICON = join(__dirname, '../../resources/icon.png');

/** Title bar colors, matching the renderer's --bg and --ink tokens. */
const titleBarColors = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#171B1E', symbolColor: '#E6EAEB' }
    : { color: '#E4E7E6', symbolColor: '#262B2F' };

// The OS draws the window buttons (traffic lights on macOS, on the right elsewhere) in a 44px bar; the overlay
// tells the renderer where they are through env(titlebar-area-*), so it never guesses their size.
// Built when the window is created: nativeTheme is only reliable once the app is ready.
const titleBarOptions = () =>
  ({
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...titleBarColors(), height: TITLE_BAR_HEIGHT },
  }) as const;

/** Keeps the title bar's colors in step with the OS theme. */
export function followTheme() {
  nativeTheme.on('updated', () => {
    if (process.platform !== 'darwin') {
      mainWindow?.setTitleBarOverlay({ ...titleBarColors(), height: TITLE_BAR_HEIGHT });
    }
  });
}

export const platform = (): AppInfo['platform'] =>
  process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';

/** Sizes the window to the renderer's content: never taller than 760px or the screen it's on; the renderer scrolls what doesn't fit. */
export function fitWindow(height: unknown) {
  if (!mainWindow || typeof height !== 'number' || !Number.isFinite(height)) {
    return;
  }
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  mainWindow.setContentSize(
    WINDOW_WIDTH,
    Math.round(Math.min(Math.max(height, 120), 760, workArea.height - 40)),
  );
}

export function createWindow() {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: 420,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: APP_NAME,
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1E2327' : '#F6F7F6',
    ...titleBarOptions(),
    // The renderer is sandboxed and isolated, and reaches main only through the preload. Pinned by window.test.ts.
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  window.once('ready-to-show', () => window.show());
  // Never leave the app page: a dropped file or link would otherwise load with the preload API attached.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

/** Hides the window and, on macOS, the Dock icon: the app stays in the tray. */
export function hideWindow() {
  const window = mainWindow;
  if (!window) {
    return;
  }
  window.hide();
  // A little over the second Electron needs between Dock changes, so this hide isn't the one it drops.
  clearTimeout(dockHide);
  dockHide = setTimeout(
    () => {
      if (window.isVisible() || !app.dock) {
        return;
      }
      app.dock.hide();
      dockChangedAt = Date.now();
    },
    Math.max(0, dockChangedAt + 1100 - Date.now()),
  );
}

/** Brings the window back from the tray, or forward, e.g. when the app is started a second time. */
export async function showWindow() {
  const window = mainWindow;
  if (!window) {
    return;
  }
  // A hide still waiting would take the Dock icon away while the window comes back.
  clearTimeout(dockHide);
  if (app.dock) {
    await app.dock.show();
    dockChangedAt = Date.now();
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  app.focus({ steal: true });
}
