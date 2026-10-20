import { isDerivedRule, newRoute, retarget, routeTarget, type Config, type RouteRule } from "@repo/core";

/** The config with one of a VPN's rules pinned: a rule it got from its server becomes one of its own sites, pinned. */
export function withPinnedRule(config: Config, rule: RouteRule): Config {
  const routes = isDerivedRule(rule)
    ? [...config.routes, { ...retarget(newRoute("", rule.vpnId), routeTarget(rule)), pinned: true }]
    : config.routes.map((route) => (route.id === rule.id ? { ...route, pinned: true } : route));
  return { ...config, routes };
}
