import { SETUP_BUSY, setupProblems } from '../domain/setup-copy.ts';
import { useApp } from '../store/app-model.ts';
import { cx, link } from '@repo/ui/tokens.ts';
import { useSetupAction } from './use-setup-action.ts';

/** Returning users only need the one thing that's wrong, not the first-run checklist. */
export function SetupLine() {
  const app = useApp();
  const helper = useSetupAction(() => app.runHelper('install'));
  const { docker: dockerProblem, helper: helperProblem } = setupProblems(app.docker, app.helper?.state);
  if (!dockerProblem && !helperProblem) return null;
  const line = (text: string, action: string | undefined, busy: boolean, busyText: string, error: string | undefined, run: () => void) => (
    <span className="grid gap-0.5">
      <span className="flex items-baseline justify-between gap-2.5">
        <span>{busy ? busyText : text}</span>
        {action && !busy && (
          <button type="button" className={cx(link, 'whitespace-nowrap')} onClick={run}>
            {action}
          </button>
        )}
      </span>
      {error && <span className="text-[12.5px] whitespace-pre-wrap text-danger select-text">{error}</span>}
    </span>
  );
  return (
    <div role="status" className="mx-[var(--in)] my-2.5 grid gap-1 rounded-lg bg-sodium/11 px-[11px] py-2 text-[13px]">
      {dockerProblem && line(dockerProblem.line, dockerProblem.action?.link, app.dockerStart.starting, SETUP_BUSY.docker, app.dockerStart.error, () => void app.startDocker())}
      {helperProblem && line(helperProblem.line, helperProblem.action?.link, helper.busy, SETUP_BUSY.helper, helper.error, helper.go)}
    </div>
  );
}
