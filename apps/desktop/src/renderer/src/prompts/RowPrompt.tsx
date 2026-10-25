import type { Vpn } from '@repo/core';
import { useApp } from '../store/app-model.ts';
import { BrowserSignInPrompt } from './BrowserSignInPrompt.tsx';
import { CertificatePrompt } from './CertificatePrompt.tsx';
import { CodePrompt } from './CodePrompt.tsx';
import { PasswordPrompt } from './PasswordPrompt.tsx';

/**
 * What a connecting VPN asks the user, shown inside its row (and on its page): the app's own prompts first
 * (a password that isn't remembered, a certificate to trust), then whatever the VPN's client waits for.
 */
export function RowPrompt({ vpn }: { vpn: Vpn }) {
  const app = useApp();
  const prompt = app.prompt?.vpnId === vpn.id ? app.prompt : undefined;
  const connection = app.connections[vpn.id];
  if (prompt) {
    return prompt.kind === 'password' ? (
      <PasswordPrompt vpn={vpn} />
    ) : (
      <CertificatePrompt vpn={vpn} prompt={prompt} />
    );
  }
  if (connection?.state === 'awaiting-code') {
    return <CodePrompt vpn={vpn} prompt={connection.prompt} secret={connection.secret} />;
  }
  if (connection?.state === 'awaiting-browser') {
    return <BrowserSignInPrompt vpn={vpn} />;
  }
  return null;
}
