import type { ConnectionState, ConnectionStatus } from '@repo/core';

const MAX_LOG_LINES = 300;

/**
 * Each VPN's connection status and log, reported through `onChange` on every state change.
 * Log lines arrive in bursts, so they're batched into at most a few updates per second.
 */
export function createStatusBoard(onChange: (statuses: Record<string, ConnectionStatus>) => void) {
  const statuses = new Map<string, ConnectionStatus>();
  let emitTimer: NodeJS.Timeout | undefined;

  const emit = () => {
    clearTimeout(emitTimer);
    emitTimer = undefined;
    onChange(Object.fromEntries(statuses));
  };

  const emitSoon = () => {
    emitTimer ??= setTimeout(emit, 250);
  };

  return {
    get: (vpnId: string) => statuses.get(vpnId),
    all: () => Object.fromEntries(statuses),

    /** Starts a new attempt for this VPN: the state, with an empty log. */
    begin(vpnId: string, state: ConnectionState) {
      statuses.set(vpnId, { ...state, log: [] });
      emit();
    },

    /** Changes this VPN's state, keeping its log. */
    set(vpnId: string, state: ConnectionState) {
      statuses.set(vpnId, { ...state, log: statuses.get(vpnId)?.log ?? [] });
      emit();
    },

    /** Appends lines to this VPN's log (ignored until it has a status). */
    logger: (vpnId: string) => (line: string) => {
      const status = statuses.get(vpnId);
      if (!status) {
        return;
      }

      status.log.push(line);

      if (status.log.length > MAX_LOG_LINES) {
        status.log.splice(0, status.log.length - MAX_LOG_LINES);
      }

      emitSoon();
    },
  };
}

export type StatusBoard = ReturnType<typeof createStatusBoard>;
