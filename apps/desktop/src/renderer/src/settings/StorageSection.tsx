import type { AppInfo } from '../../../shared/ipc-contract.ts';
import { useApp } from '../store/app-model.ts';
import { cell, cells, cx, groupTitle, hint, link } from '@repo/ui/tokens.ts';

const KEYCHAIN: Record<AppInfo['platform'], string> = {
  darwin: 'Saved in the macOS Keychain',
  win32: 'Encrypted with your Windows account',
  linux: 'Saved in your keyring (GNOME Keyring or KWallet)',
};
const FILE_MANAGER: Record<AppInfo['platform'], string> = {
  darwin: 'Show in Finder',
  win32: 'Show in Explorer',
  linux: 'Show in file manager',
};

/** Where passwords and the settings file are kept. */
export function StorageSection() {
  const app = useApp();
  return (
    <section className="mt-5">
      <h2 className={groupTitle}>Storage</h2>
      <div className={cells}>
        <div className={cell}>
          <span>
            Passwords and keys
            <span className={cx(hint, app.keychainProblem && 'text-danger')}>
              {app.keychainProblem ?? KEYCHAIN[app.info.platform]}
            </span>
          </span>
        </div>
        <div className={cell}>
          <span className="min-w-0">
            Settings file
            <span className={cx(hint, 'break-all select-text')}>{app.configPath}</span>
          </span>
          <button
            type="button"
            className={cx(link, 'whitespace-nowrap')}
            onClick={() => void app.api.showConfig()}
          >
            {FILE_MANAGER[app.info.platform]}
          </button>
        </div>
      </div>
    </section>
  );
}
