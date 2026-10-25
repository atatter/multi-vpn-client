import { newRoute, retarget, RouteRule, routeTarget } from '@repo/core';
import { listOf } from '@repo/ui/format.ts';

/**
 * Parses typed text (several entries, separated by spaces or commas) into new rules for `vpnId`.
 * What isn't a domain or IP range stays as `text`, with the reason in `problem`.
 */
export function addEntries(text: string, routes: readonly RouteRule[], vpnId: string): { routes: RouteRule[]; text: string; problem: string | undefined } {
  const added: RouteRule[] = [];
  const bad: string[] = [];
  const dupes: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const parsed = RouteRule.safeParse(retarget(newRoute('', vpnId), token));
    if (!parsed.success) bad.push(token);
    else if ([...routes, ...added].some((route) => routeTarget(route) === routeTarget(parsed.data))) dupes.push(routeTarget(parsed.data));
    else added.push(parsed.data);
  }
  const problem = [
    bad.length ? `${listOf(bad)} ${bad.length === 1 ? "isn't a site or IP range" : "aren't sites or IP ranges"}.` : '',
    dupes.length ? `${listOf(dupes)} ${dupes.length === 1 ? 'is' : 'are'} already in the list.` : '',
  ]
    .join(' ')
    .trim();
  return { routes: [...routes, ...added], text: bad.join(' '), problem: problem || undefined };
}
