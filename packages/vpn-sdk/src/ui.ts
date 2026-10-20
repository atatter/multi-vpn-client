import type { ReactNode } from "react";
import type { z } from "zod";
import type { Action } from "./kind.ts";

/**
 * What a VPN kind's window side is made of: its wording and its form's fields, as React components built
 * from @repo/ui. The window reaches them through @repo/vpns's FORMS and knows no kind by name.
 */

/** Field path → message, e.g. "remotes.0" → "Expected a host". */
export type FormErrors = Record<string, string>;

/** The error at `path` or anywhere under it, e.g. "addresses" for an issue at "addresses.1". */
export const errorAt = (errors: FormErrors, path: string) => errors[path] ?? Object.entries(errors).find(([key]) => key.startsWith(`${path}.`))?.[1];

/** Secrets typed in the form so far, by slot: a new value, or null to clear the stored one. */
export type PendingSecrets = Record<string, string | null>;

export const CERT_PIN_HINT = "Filled in when you trust the gateway's certificate. Clear it to be asked again.";

/** Runs one of this kind's actions in main by name. Rejects with an Error whose message is for the user. Call it through `callAction`. */
export type RunAction = (name: string, input: unknown) => Promise<unknown>;

const parse = <O extends z.ZodType>(schema: O, value: unknown): z.output<O> => schema.parse(value);

/** A form's call of one of its kind's actions (its kind file's `…_ACTIONS`): name and input typed by the declaration, the answer parsed by it. */
export async function callAction<A extends { [N in keyof A]: Action }, N extends keyof A & string>(
  runAction: RunAction,
  declared: A,
  name: N,
  input: z.input<A[N]["input"]>,
): Promise<z.output<A[N]["output"]>> {
  // Explicit type argument: inferred from declared[name], TypeScript would settle for Action's own schema type.
  return parse<A[N]["output"]>(declared[name].output, await runAction(name, input));
}

/** A kind's fields get that kind's VPN, so a change can only touch its own fields. */
export interface KindFieldsProps<V> {
  vpn: V;
  onChange: (vpn: V) => void;
  errors: FormErrors;
}

/** The account fields also see the secrets typed so far, and whether the address is shown. */
export interface MainFieldsProps<V> extends KindFieldsProps<V> {
  pending: PendingSecrets;
  storedSlots: readonly string[];
  /** A new value, null to clear the stored one, undefined to drop what was typed. */
  setSecret: (key: string, value: string | null | undefined) => void;
  /** The sign-in step after detecting the address shows it as text instead of a field. */
  showAddress: boolean;
  runAction: RunAction;
}

/** Everything the window says and shows for one kind. Registered in @repo/vpns's FORMS. */
export interface KindForm<V> {
  /** Its name on every screen, e.g. in "New Check Point VPN". */
  label: string;
  /** Under the label in the kind picker. */
  hint: string;
  /** Its settings that differ from its defaults, for the folded Advanced line. */
  changed?: (vpn: V) => string[];
  /** What it signs in with when that isn't a password (GlobalProtect's ID card); the password fields go. */
  signsInWith?: (vpn: V) => string | undefined;
  /** Shown when its server signs in through the browser, for a kind this app can't do that for yet. */
  noBrowserSignIn?: string;
  /** The fields it can't connect without. */
  Main: (props: MainFieldsProps<V>) => ReactNode;
  /** Settings most people never touch, under Advanced. */
  More?: (props: KindFieldsProps<V>) => ReactNode;
  /** The username field's hint and placeholder, for this VPN's settings. */
  username?: (vpn: V) => { hint?: string; placeholder?: string };
  /** Hint and example for the raw extra options. */
  extraOptions: { hint: string; placeholder: string };
}
