import { SETUP_BUSY, setupProblems } from '../domain/setup-copy.ts';
import { useApp } from '../store/app-model.ts';
import { cx, primary } from '@repo/ui/tokens.ts';
import { useSetupAction } from './use-setup-action.ts';

type StepText = { done: string; busy: string; todo: string };

type Step = {
  done: boolean;
  busy: boolean;
  title: string;
  text: StepText;
  action: string | undefined;
  error: string | undefined;
  run: () => void;
};

const stepText = (done: boolean, busy: boolean, text: StepText) => {
  if (done) {
    return text.done;
  }

  return busy ? text.busy : text.todo;
};

/** First launch: everything that must be in place before the first connection, in one card, instead of failing later. */
export function SetupCard() {
  const app = useApp();
  const helper = useSetupAction(() => app.runHelper('install'));
  const helperState = app.helper?.state;
  const dockerReady = app.docker === 'running';
  const helperReady = helperState === 'ready';
  if ((dockerReady || !app.docker) && (helperReady || !helperState)) {
    return null;
  }

  const step = ({ done, busy, title, text, action, error, run }: Step) => (
    <div className="grid grid-cols-[20px_1fr_auto] items-center gap-2 border-t border-sodium/20 px-3 py-2 text-[13.5px]">
      <span
        className={cx(
          'grid size-[18px] place-items-center rounded-full border-[1.5px]',
          done ? 'border-go-track bg-go-track text-white' : 'border-off',
        )}
      >
        {done && '✓'}
        {!done && busy && (
          <span className="size-3 animate-spin rounded-full border-2 border-rule-strong border-t-sodium" />
        )}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{title}</span>
        <span className="block text-[12.5px] text-muted">{stepText(done, busy, text)}</span>
        {error && (
          <span className="block text-[12.5px] whitespace-pre-wrap text-danger select-text">
            {error}
          </span>
        )}
      </span>
      {!done && action && (
        <button
          type="button"
          className={cx(primary, 'px-3 py-[5px] text-[13px]')}
          disabled={busy}
          onClick={run}
        >
          {busy ? 'Waiting…' : action}
        </button>
      )}
    </div>
  );

  const problems = setupProblems(app.docker, helperState);

  return (
    <section
      aria-label="Finish setting up"
      className="mx-[var(--in)] mt-3 rounded-[10px] border border-sodium/35 bg-[color-mix(in_srgb,var(--sodium)_7%,var(--field))]"
    >
      <h2 className="px-3 pt-2.5 pb-0.5 text-sm font-semibold">
        Two things before the first connection
      </h2>
      <p className="px-3 pb-1.5 text-[13px] text-muted">
        You can add VPNs now. They connect as soon as these are done.
      </p>
      {app.docker &&
        step({
          done: dockerReady,
          busy: app.dockerStart.starting,
          title: 'Docker',
          text: { done: 'Running', busy: SETUP_BUSY.docker, todo: problems.docker?.card ?? '' },
          action: problems.docker?.action?.button,
          error: app.dockerStart.error,
          run: () => void app.startDocker(),
        })}
      {helperState &&
        step({
          done: helperReady,
          busy: helper.busy,
          title: 'Network helper',
          text: { done: 'Installed', busy: SETUP_BUSY.helper, todo: problems.helper?.card ?? '' },
          action: problems.helper?.action?.button,
          error: helper.error,
          run: helper.go,
        })}
    </section>
  );
}
