import { ALL_TRAFFIC, isBroad, placeVpn, type PlanLayer, type Vpn } from '@repo/core';
import { isOn, onIds, setupProblem } from '../domain/connection.ts';
import { accountLabel, shortTarget, vpnLabel } from '../domain/labels.ts';
import { setupBlocker } from '../domain/setup-copy.ts';
import { listOf } from '@repo/ui/format.ts';
import { TONES } from '@repo/ui/tokens.ts';
import type { AppModel } from './app-model.ts';

/** The wording rows and screens use for what a VPN carries. One place, so every screen says the same. */

export type Tone = keyof typeof TONES;

/** Whether a VPN asks the user something right now (what `prompts/RowPrompt` shows): one of the app's prompts, or its client waiting. */
export const hasRowPrompt = (vpn: Vpn, app: Pick<AppModel, 'prompt' | 'connections'>) => {
  const state = app.connections[vpn.id]?.state;
  return app.prompt?.vpnId === vpn.id || state === 'awaiting-code' || state === 'awaiting-browser';
};

/** What a VPN carries when it's on, in a word or two. Leads every idle row, so all-traffic VPNs are easy to find. */
function scopeLabel(vpn: Vpn): string {
  if (vpn.traffic === 'official' && !vpn.serverRoutes) {
    return 'Routes known after first connect';
  }
  if (isBroad(vpn)) {
    return 'All traffic';
  }

  return vpn.traffic === 'sites' ? 'Chosen sites' : 'Its network';
}

/** Why a turned-on VPN carries nothing, and the one action that changes it: outcome first, then the cause. */
export function standbyWhy(vpn: Vpn, byName: string) {
  return isBroad(vpn)
    ? {
        why: `Not in use. ${byName}, above it, already carries all traffic.`,
        action: 'Use this one instead',
      }
    : {
        why: `Not in use. ${byName}, above it, carries all traffic, this network included.`,
        action: 'Use this one for its network',
      };
}

/** standbyWhy's action: moves the VPN just above the one keeping it unused. */
export const putAbove = (app: AppModel, vpnId: string, aboveId: string) =>
  app.save({ ...app.config, priority: placeVpn(app.config, vpnId, aboveId, 'above') });

/**
 * What a connected VPN really carries, given everything above it. No counts: "3 routes" can be three
 * addresses or three whole networks. A single address another VPN takes is named instead.
 */
function layerText(
  layer: PlanLayer,
  vpn: Vpn,
  nameOf: (vpnId: string) => string,
): { text: string; tone: Tone } {
  if (layer.starvedBy) {
    return { text: standbyWhy(vpn, nameOf(layer.starvedBy)).why, tone: 'standby' };
  }

  if (layer.broad) {
    // A higher VPN carrying everything leaves this one only its pins.
    const everything = layer.fates.find(
      (fate) => fate.rule.kind === 'cidr' && fate.rule.cidr === ALL_TRAFFIC && !fate.rule.pinned,
    );
    if (everything?.taken && !everything.taken.partly) {
      return {
        text: `Pinned sites only · ${nameOf(everything.taken.by)} carries the rest`,
        tone: 'go',
      };
    }

    return {
      text: layer.fates.some((fate) => fate.taken?.partly) ? 'Everything else' : 'All traffic',
      tone: 'go',
    };
  }

  const what = vpn.traffic === 'sites' ? 'Chosen sites' : 'Its network';
  const lost = layer.fates.flatMap((fate) =>
    fate.taken ? [{ rule: fate.rule, taken: fate.taken }] : [],
  );
  if (lost.length === 0) {
    return { text: what, tone: 'go' };
  }

  const winners = listOf([...new Set(lost.map((fate) => nameOf(fate.taken.by)))]);
  // Lost to a pin is a choice someone made, not a problem: say it, but don't flag it.
  const pinned = lost.every((fate) => fate.taken.byPin);
  const tone = pinned ? 'go' : 'sodium';
  const suffix = pinned ? ' (pinned)' : '';
  if (lost.length === layer.fates.length && lost.every((fate) => !fate.taken.partly)) {
    return { text: `${what} · all of it goes to ${winners}${suffix}`, tone };
  }

  const [only] = lost;
  if (only && lost.length === 1) {
    return {
      text: `${what} · ${only.taken.partly ? 'part of ' : ''}${shortTarget(only.rule)} goes to ${winners}${suffix}`,
      tone,
    };
  }

  return { text: `${what} · part goes to ${winners}${suffix}`, tone };
}

/** The one rule another VPN fully takes by priority, if exactly one: the row offers to pin it back. Never "everything". */
export function lostOne(layer: PlanLayer) {
  if (layer.broad || layer.starvedBy) {
    return undefined;
  }

  const lost = layer.fates.filter((fate) => fate.taken && !fate.taken.partly);
  const [only] = lost;

  return only && lost.length === 1 && !only.taken?.byPin ? only : undefined;
}

/** The one line under a VPN's name: what it's doing, what it really carries, or what it would carry. */
export function statusOf(
  vpn: Vpn,
  app: AppModel,
  layer: PlanLayer | undefined,
): { scope?: string; text: string; tone: Tone; rate?: boolean; wrap?: boolean } {
  const prompt = app.prompt?.vpnId === vpn.id ? app.prompt : undefined;
  if (app.waiting.has(vpn.id)) {
    return { text: setupBlocker(app.docker, app.helper) ?? 'Connecting…', tone: 'sodium' };
  }
  if (prompt?.kind === 'password') {
    return { text: 'Enter your password to connect', tone: 'sodium' };
  }
  if (prompt?.kind === 'certificate') {
    return prompt.changed
      ? { text: 'Its certificate changed', tone: 'danger' }
      : { text: 'Check its certificate to connect', tone: 'sodium' };
  }

  const status = app.connections[vpn.id];
  const nameOf = (vpnId: string) =>
    vpnLabel(app.config.vpns.find((other) => other.id === vpnId) ?? { name: '' });

  switch (status?.state) {
    case 'connecting':
      return { text: status.step, tone: 'sodium' };
    case 'awaiting-code':
      return {
        text: status.secret
          ? 'Enter your PIN or password to finish connecting'
          : 'Answer below to finish connecting',
        tone: 'sodium',
      };
    case 'awaiting-browser':
      return { text: 'Sign in in your browser to connect', tone: 'sodium' };
    case 'awaiting-card':
      return { text: `Insert your ${status.card} into the card reader`, tone: 'sodium' };
    case 'error':
      return { text: status.message.split('\n')[0] ?? status.message, tone: 'danger', wrap: true };
    case 'connected': {
      if (status.warning) {
        return { text: status.warning, tone: 'sodium', wrap: true };
      }
      if (!layer) {
        return { text: 'Connected', tone: 'go' };
      }

      const { text, tone } = layerText(layer, vpn, nameOf);
      return { text, tone, rate: tone === 'go', wrap: tone !== 'go' };
    }
    default: {
      const problem = setupProblem(vpn, app.secretStatus[vpn.id] ?? []);
      // Something the user has to do before it can connect: not idle wording, so it stands out.
      if (problem) {
        return { text: problem, tone: 'sodium' };
      }

      return { scope: scopeLabel(vpn), text: ` · ${accountLabel(vpn)}`, tone: 'muted' };
    }
  }
}

/** Why the switch is off-limits, if it is (shown as its tooltip). */
export function switchBlocker(vpn: Vpn, app: AppModel): string | undefined {
  if (isOn(app.connections[vpn.id])) {
    return undefined;
  }

  return setupProblem(vpn, app.secretStatus[vpn.id] ?? []);
}

/** A VPN's switch: on for anything but off (waiting, asking, connecting, connected, failed), and its color. Same on the list and its page. */
export function switchLook(vpnId: string, app: AppModel, layer: PlanLayer | undefined) {
  const connection = app.connections[vpnId];
  const on = onIds(app.connections, app.prompt, app.waiting).has(vpnId);
  if (connection?.state === 'error') {
    return { on, tone: 'error' } as const;
  }
  if (on && connection?.state !== 'connected') {
    return { on, tone: 'busy' } as const;
  }

  return { on, tone: layer?.starvedBy ? 'standby' : 'go' } as const;
}
