import { isSlotKept, kindSpec, PASSWORD_SLOT, Vpn } from '@repo/core';
import type { PendingSecrets } from '../domain/secrets.ts';
import { SecretField } from '@repo/ui/controls/SecretField.tsx';
import { TextField } from '@repo/ui/controls/TextField.tsx';
import { ToggleRow } from '@repo/ui/controls/ToggleRow.tsx';
import { cx, note } from '@repo/ui/tokens.ts';
import type { FormErrors } from '../domain/form-errors.ts';
import { usesPassword } from '../domain/connection.ts';
import { useApp } from '../store/app-model.ts';
import { messageOf } from '../store/errors.ts';
import type { RunAction } from '@repo/vpn-sdk/ui';
import { KindMainFields, usernameCopy } from './kind-forms.tsx';

interface AccountProps {
  vpn: Vpn;
  onChange: (vpn: Vpn) => void;
  pending: PendingSecrets;
  onPendingChange: (pending: PendingSecrets) => void;
  storedSlots: readonly string[];
  /** Errors appear once the user has tried to continue, not while they type. */
  errors: FormErrors;
  keychainProblem: string | undefined;
  /** Shows the address field; the sign-in step after detecting it shows the address as text instead. */
  showAddress?: boolean;
  /** Shows the name field (the VPN's page); the sign-in step has it under "Name and traffic". */
  showName?: boolean;
}

/** What a VPN signs in with: its address, the sign-in method, username and password (or key). */
export function AccountFields({
  vpn,
  onChange,
  pending,
  onPendingChange,
  storedSlots,
  errors,
  keychainProblem,
  showAddress = true,
  showName = false,
}: AccountProps) {
  const { api } = useApp();
  // The kind's form shows a failed action's message as is, so it gets main's message without Electron's prefix.
  const runAction: RunAction = (name, input) =>
    api
      .runAction(vpn.kind, name, input)
      .catch((error: unknown) => Promise.reject(new Error(messageOf(error))));
  const setSecret = (key: string, value: string | null | undefined) => {
    const { [key]: _previous, ...rest } = pending;
    onPendingChange(value === undefined ? rest : { ...rest, [key]: value });
  };
  const slots = kindSpec(vpn.kind).secrets;
  const typedSecrets = slots.filter((slot) => slot.storage === 'always' && !slot.importOnly);
  const usernameText = usernameCopy(vpn);
  const hasPassword = usesPassword(vpn);
  const passwordKey = PASSWORD_SLOT.key;

  const setRemember = (rememberPassword: boolean) => {
    onChange({ ...vpn, rememberPassword });
    // A password typed while remembering mustn't be saved once it's off; a stored one goes too.
    if (!rememberPassword) {
      setSecret(passwordKey, storedSlots.includes(passwordKey) ? null : undefined);
    }
  };
  const rememberHint = vpn.rememberPassword
    ? 'Saved in your system keychain.'
    : "You'll be asked each time you connect.";

  return (
    <>
      {showName && (
        <TextField
          label="Name"
          value={vpn.name}
          placeholder="Client or network name"
          error={errors.name}
          onChange={(name) => onChange({ ...vpn, name })}
        />
      )}
      <KindMainFields
        kind={vpn.kind}
        vpn={vpn}
        onChange={onChange}
        errors={errors}
        pending={pending}
        storedSlots={storedSlots}
        setSecret={setSecret}
        showAddress={showAddress}
        runAction={runAction}
      />
      {keychainProblem && (
        <p className={cx(note, 'mb-3 bg-chip text-sodium')}>
          {keychainProblem} Passwords and keys can't be saved on this computer.
        </p>
      )}
      {'username' in vpn && (
        <TextField
          label="Username"
          value={vpn.username}
          placeholder={usernameText.placeholder ?? ''}
          error={errors.username}
          hint={usernameText.hint}
          onChange={(username) => onChange({ ...vpn, username })}
        />
      )}
      {hasPassword && (
        <>
          <ToggleRow
            label="Remember password"
            hint={keychainProblem ? 'Not available on this computer.' : rememberHint}
            checked={vpn.rememberPassword}
            disabled={!!keychainProblem}
            onChange={setRemember}
          />
          {vpn.rememberPassword && (
            <SecretField
              label="Password"
              stored={storedSlots.includes(passwordKey)}
              pending={pending[passwordKey]}
              hint="Leave it empty to be asked when you connect."
              onChange={(value) => setSecret(passwordKey, value)}
            />
          )}
        </>
      )}
      {typedSecrets
        .filter((slot) => isSlotKept(vpn, slot))
        .map((slot) => (
          <SecretField
            key={slot.key}
            label={slot.label}
            stored={storedSlots.includes(slot.key)}
            pending={pending[slot.key]}
            error={errors[`secrets.${slot.key}`]}
            hint={slot.required ? undefined : 'Only if your provider gave you one.'}
            onChange={(value) => setSecret(slot.key, value)}
          />
        ))}
    </>
  );
}
