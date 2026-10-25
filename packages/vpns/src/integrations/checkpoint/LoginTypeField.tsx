import { HostPort } from '@repo/vpn-sdk';
import { callAction, type RunAction } from '@repo/vpn-sdk/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { cell, cells, cx, hint, input, label, link, mono } from '@repo/ui/tokens.ts';
import { canUseLoginType, CHECKPOINT_ACTIONS, type CheckpointLoginType } from './kind.ts';

/**
 * A Check Point login type is an id like "vpn_OTP" that the gateway lists; the official client shows
 * only its display name ("MFA"). Looking them up asks the gateway, so the user can pick by name.
 */
export function LoginTypeField({
  server,
  value,
  error,
  onChange,
  autoLookup,
  runAction,
}: {
  server: string;
  value: string;
  error: string | undefined;
  onChange: (loginType: string) => void;
  autoLookup: boolean;
  runAction: RunAction;
}) {
  const [lookup, setLookup] = useState<
    { server: string } & (
      | { state: 'busy' }
      | { state: 'done'; types: CheckpointLoginType[] }
      | { state: 'failed'; message: string }
    )
  >();
  const validServer = HostPort.safeParse(server);
  // Results belong to the server they came from; editing it hides them.
  const shown = lookup?.server === server.trim() ? lookup : undefined;
  const find = async () => {
    if (!validServer.success) {
      return;
    }

    const target = validServer.data;
    setLookup({ server: target, state: 'busy' });
    // A lookup for another server since then wins; this one's answer is dropped.
    const settle = (next: NonNullable<typeof lookup>) =>
      setLookup((current) => (current?.server === target ? next : current));

    try {
      settle({
        server: target,
        state: 'done',
        types: await callAction(runAction, CHECKPOINT_ACTIONS, 'loginTypes', target),
      });
    } catch (lookupError) {
      settle({
        server: target,
        state: 'failed',
        message: lookupError instanceof Error ? lookupError.message : String(lookupError),
      });
    }
  };
  // Once, on arrival: later lookups are the user's choice.
  const lookUpOnArrival = useEffectEvent(() => {
    if (autoLookup && validServer.success && !value) {
      void find();
    }
  });
  // The lookup's busy state is set as it starts, which is the point of this effect.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => lookUpOnArrival(), []);
  const failure = error || (shown?.state === 'failed' ? shown.message : undefined);

  return (
    <div className="mb-3 grid gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className={label}>Login type</span>
        <button
          type="button"
          className={link}
          disabled={!validServer.success || shown?.state === 'busy'}
          onClick={() => void find()}
        >
          {shown?.state === 'busy' ? 'Looking up…' : 'Look up'}
        </button>
      </div>
      <input
        className={cx(input(!!error), mono)}
        value={value}
        placeholder="vpn_Username_Password"
        spellCheck={false}
        aria-label="Login type"
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
      />
      {shown?.state === 'done' && (
        <div className={cells}>
          {shown.types.map((type) => {
            const usable = canUseLoginType(type);
            return (
              <button
                key={type.id}
                type="button"
                className={cx(
                  cell,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  type.id === value && 'bg-chip',
                )}
                disabled={!usable}
                onClick={() => onChange(type.id)}
              >
                <span className="grid min-w-0">
                  <span className="truncate text-[13px] font-semibold">{type.label}</span>
                  <span className={cx(mono, 'truncate text-muted')}>{type.id}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-muted">
                  {usable ? type.factors.join(', ') : 'Not supported yet'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {failure ? (
        <span className="text-[12.5px] text-danger select-text">{failure}</span>
      ) : (
        <span className={hint}>
          {shown?.state === 'busy'
            ? 'The first lookup also sets up the Check Point client, which takes a minute or two.'
            : 'Look up the ones your gateway offers, then pick yours (e.g. MFA).'}
        </span>
      )}
    </div>
  );
}
