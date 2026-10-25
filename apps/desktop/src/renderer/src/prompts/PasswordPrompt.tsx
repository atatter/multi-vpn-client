import type { Vpn } from '@repo/core';
import { useState } from 'react';
import { vpnLabel } from '../domain/labels.ts';
import { useApp } from '../store/app-model.ts';
import { Switch } from '@repo/ui/controls/Switch.tsx';
import { input, link, primary } from '@repo/ui/tokens.ts';

/** Asked in the row when the password isn't remembered. Typed for this connection only, unless "Remember" is on. */
export function PasswordPrompt({ vpn }: { vpn: Vpn }) {
  const app = useApp();
  const [password, setPassword] = useState('');
  // Starts as the VPN's own setting: someone who chose to remember it shouldn't have to say so again.
  const [remember, setRemember] = useState(vpn.rememberPassword);
  const user = 'username' in vpn && vpn.username ? vpn.username : undefined;
  return (
    <form
      aria-label={`Sign in to ${vpnLabel(vpn)}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (password) app.submitPassword(password, remember);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        app.cancelPrompt();
      }}
    >
      <input
        type="password"
        className={input()}
        value={password}
        placeholder={user ? `Password for ${user}` : 'Password'}
        aria-label={user ? `Password for ${user}` : 'Password'}
        autoComplete="off"
        autoFocus
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="my-2.5 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium">Remember password</span>
        <Switch label="Remember password" checked={remember} disabled={!!app.keychainProblem} title={app.keychainProblem} onChange={setRemember} />
      </div>
      <div className="flex items-center justify-end gap-4">
        <button type="button" className={link} onClick={app.cancelPrompt}>
          Cancel
        </button>
        <button type="submit" className={primary} disabled={!password}>
          Connect
        </button>
      </div>
    </form>
  );
}
