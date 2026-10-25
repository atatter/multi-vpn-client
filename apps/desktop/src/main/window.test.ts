import { describe, expect, it, vi } from 'vitest';

type Handler = (event: { preventDefault: () => void }) => void;
const created: { options: Electron.BrowserWindowConstructorOptions; openHandler?: () => unknown; handlers: Map<string, Handler> }[] = [];

vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false, on: () => {} },
  screen: {},
  BrowserWindow: class {
    readonly record: (typeof created)[number];
    readonly webContents = {
      setWindowOpenHandler: (handler: () => unknown) => void (this.record.openHandler = handler),
      on: (event: string, handler: Handler) => void this.record.handlers.set(event, handler),
    };
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.record = { options, handlers: new Map() };
      created.push(this.record);
    }
    on() {}
    once() {}
    loadURL = async () => {};
    loadFile = async () => {};
  },
}));

const { createWindow } = await import('./window.ts');

describe('the main window', () => {
  it('keeps the renderer sandboxed and isolated, without Node, with only the preload added', () => {
    createWindow();
    const preferences = created.at(-1)?.options.webPreferences;
    expect(preferences).toEqual({ preload: expect.stringMatching(/preload[/\\]index\.js$/), sandbox: true, contextIsolation: true, nodeIntegration: false });
  });

  it('never opens or navigates to another page', () => {
    createWindow();
    const window = created.at(-1);
    expect(window?.openHandler?.()).toEqual({ action: 'deny' });
    const preventDefault = vi.fn<() => void>();
    window?.handlers.get('will-navigate')?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
