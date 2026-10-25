import { useState } from 'react';
import { DOCKER_SETUP, HELPER_SETUP, SETUP_BUSY } from '../domain/setup-copy.ts';
import { type AppModel, useApp } from '../store/app-model.ts';
import { cell, cells, cx, groupTitle, hint, link } from '@repo/ui/tokens.ts';

function dockerLine(docker: AppModel['docker'], starting: boolean) {
  if (docker === 'running') {
    return 'Running';
  }
  if (starting) {
    return SETUP_BUSY.docker;
  }
  return docker ? DOCKER_SETUP[docker].settings : 'Checking…';
}

/** What connecting needs, with the fixes the app can run: start Docker, install, update or remove the helper. */
export function SetupSection() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const helper =
    app.helper &&
    (app.helper.state === 'ready'
      ? { settings: "Installed. Connecting won't ask for your password.", action: undefined }
      : HELPER_SETUP[app.helper.state]);
  const runHelper = (action: 'install' | 'uninstall') => {
    setBusy(true);
    setError(undefined);
    void app.runHelper(action).then((problem) => {
      setError(problem);
      setBusy(false);
    });
  };
  const problem = (text: string | undefined) =>
    text && (
      <span className="block text-[12.5px] whitespace-pre-wrap text-danger select-text">
        {text}
      </span>
    );

  return (
    <section className="mt-5">
      <h2 className={groupTitle}>Needed to connect</h2>
      <div className={cells}>
        <div className={cell}>
          <span className="min-w-0">
            Docker
            <span className={cx(hint, app.docker !== 'running' && 'text-sodium')}>
              {dockerLine(app.docker, app.dockerStart.starting)}
            </span>
            {problem(app.dockerStart.error)}
          </span>
          {app.docker === 'stopped' && (
            <button
              type="button"
              className={link}
              disabled={app.dockerStart.starting}
              onClick={() => void app.startDocker()}
            >
              {DOCKER_SETUP.stopped.action?.button}
            </button>
          )}
        </div>
        {app.helper && helper && (
          <div className={cell}>
            <span className="min-w-0">
              Network helper
              <span className={cx(hint, app.helper.state !== 'ready' && 'text-sodium')}>
                {busy ? SETUP_BUSY.helper : helper.settings}
              </span>
              {app.helper.state === 'not-responding' && (
                <span className={cx(hint, 'select-text')}>Log: {app.helper.logHint}</span>
              )}
              {problem(error)}
            </span>
            <span className="flex shrink-0 gap-3">
              {helper.action && (
                <button
                  type="button"
                  className={link}
                  disabled={busy}
                  onClick={() => runHelper('install')}
                >
                  {helper.action.button}
                </button>
              )}
              {app.helper.state !== 'not-installed' && app.helper.state !== 'unsupported' && (
                <button
                  type="button"
                  className={cx(link, 'text-danger')}
                  disabled={busy}
                  onClick={() => runHelper('uninstall')}
                >
                  Uninstall
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
