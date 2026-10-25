import type { DockerState, HelperState } from '@repo/core';
import type { HelperInfo } from '../../../shared/ipc-contract.ts';

/**
 * What the app says about each setup problem, in one place so every view agrees: `card` is the first-run
 * step, `line` the returning user's notice on the list, `settings` the row in Settings, `wait` the line of
 * a VPN waiting for it. `action` is the fix, when the app can run it: a button label and a link label.
 */
interface SetupCopy {
  card: string;
  line: string;
  settings: string;
  wait: string;
  action?: { button: string; link: string };
}

export const DOCKER_SETUP: Record<Exclude<DockerState, 'running'>, SetupCopy> = {
  stopped: {
    card: 'Installed, but not running',
    line: "Docker isn't running, so nothing can connect.",
    settings: 'Not running',
    wait: 'Connects once Docker is running',
    action: { button: 'Start', link: 'Start Docker' },
  },
  missing: {
    card: 'Not installed. Install Docker Desktop, then come back.',
    line: "Docker isn't installed, so nothing can connect.",
    settings: 'Not installed. Install Docker Desktop, then come back.',
    wait: 'Connects once Docker is installed',
  },
};

export const HELPER_SETUP: Record<Exclude<HelperState, 'ready'>, SetupCopy> = {
  'not-installed': {
    card: 'One password prompt, then never again',
    line: "The network helper isn't installed.",
    settings: 'Not installed. Needed once to route VPN traffic.',
    wait: 'Connects once the network helper is installed',
    action: { button: 'Install', link: 'Install it' },
  },
  'needs-update': {
    card: 'This version of the app needs a newer helper. One password prompt.',
    line: 'The network helper needs an update.',
    settings: 'This version of the app needs a newer helper.',
    wait: 'Connects once the network helper is updated',
    action: { button: 'Update', link: 'Update it' },
  },
  'not-responding': {
    card: 'Installed, but not responding. Reinstalling usually fixes it.',
    line: "The network helper isn't responding.",
    settings: 'Installed, but not responding.',
    wait: 'Connects once the network helper responds again',
    action: { button: 'Reinstall', link: 'Reinstall it' },
  },
  unsupported: {
    card: "Connecting isn't available on this OS yet.",
    line: "Connecting isn't available on this OS yet.",
    settings: 'Not available on this OS yet.',
    wait: "Connecting isn't available on this OS yet",
  },
};

/** What each fix shows while it runs. */
export const SETUP_BUSY = {
  docker: 'Starting Docker…',
  helper: 'Approve the password prompt…',
} as const;

/** The setup problems still open, Docker first; undefined for each one that's fine or not known yet. */
export function setupProblems(docker: DockerState | undefined, helper: HelperState | undefined) {
  return {
    docker: docker && docker !== 'running' ? DOCKER_SETUP[docker] : undefined,
    helper: helper && helper !== 'ready' ? HELPER_SETUP[helper] : undefined,
  };
}

/** What still keeps every VPN from connecting, if anything: Docker first, then the network helper. */
export function setupBlocker(
  docker: DockerState | undefined,
  helper: HelperInfo | undefined,
): string | undefined {
  const problems = setupProblems(docker, helper?.state);
  return (problems.docker ?? problems.helper)?.wait;
}
