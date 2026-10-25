import { Vpn } from '@repo/core';
import type { PendingSecrets } from '../domain/secrets.ts';

/** One screen of the window. Screens push in from the right and pop back. */
export type Screen =
  | { name: 'list' }
  | { name: 'add' }
  /** Step 2 of adding: only what's needed to sign in. `source` says where the draft came from. */
  | { name: 'signin'; draft: Vpn; secrets: PendingSecrets; source: SignInSource }
  | { name: 'vpn'; vpnId: string }
  | { name: 'traffic' }
  | { name: 'check'; query?: string }
  | { name: 'settings' };

/** How a new VPN's draft was made: from its address (what was detected), a provider file, or a picked type. */
export type SignInSource =
  | { from: 'address'; browserSignIn: boolean }
  | { from: 'file'; fileName: string }
  | { from: 'type' };

/** Asked inside a VPN's row while connecting. */
export type Prompt =
  | { kind: 'password'; vpnId: string }
  /** `password` is the one typed for this attempt, reused after trusting. */
  | {
      kind: 'certificate';
      vpnId: string;
      pin: string;
      server: string;
      changed: boolean;
      password: string | undefined;
    };
