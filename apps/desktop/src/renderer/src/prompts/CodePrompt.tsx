import type { Vpn } from '@repo/core';
import { useState } from 'react';
import { vpnLabel } from '../domain/labels.ts';
import { useApp } from '../store/app-model.ts';
import { cx, input, link, mono, primary } from '@repo/ui/tokens.ts';

/**
 * Asked in the row when the VPN's client waits for something only the user has, like the SMS code a
 * Check Point gateway sends after the password, or an ID card's PIN. The label is the client's own wording.
 */
export function CodePrompt({ vpn, prompt, secret }: { vpn: Vpn; prompt: string; secret: boolean }) {
  const app = useApp();
  const [code, setCode] = useState('');
  const cancel = () => app.answer(vpn.id, null);
  return (
    <form
      aria-label={`Finish signing in to ${vpnLabel(vpn)}`}
      onSubmit={(event) => {
        event.preventDefault();
        // Passwords and PINs go as typed; a code pasted with spaces around it still works.
        if (code.trim()) {
          app.answer(vpn.id, secret ? code : code.trim());
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          return;
        }
        event.preventDefault();
        cancel();
      }}
    >
      <label className="grid gap-1">
        <span className="text-[13px] text-muted select-text">{prompt || 'Code'}</span>
        <input
          type={secret ? 'password' : 'text'}
          className={cx(input(), !secret && mono)}
          value={code}
          autoComplete={secret ? 'off' : 'one-time-code'}
          spellCheck={false}
          autoFocus
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <div className="mt-2.5 flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className={primary} disabled={!code.trim()}>
          Connect
        </button>
      </div>
    </form>
  );
}
