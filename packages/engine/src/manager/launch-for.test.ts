import { kindSpec, VPN_KINDS } from "@repo/core";
import { describe, expect, it } from "vitest";
import { LAUNCHERS } from "@repo/vpns/engine";
import { actionOf } from "./launch-for.ts";

describe("LAUNCHERS", () => {
  // A form calls its kind's actions by the names the kind declares; the engine must implement exactly those.
  it.each(VPN_KINDS)("%s implements exactly the actions its kind declares", (kind) => {
    expect(Object.keys(LAUNCHERS[kind].actions ?? {})).toEqual(Object.keys(kindSpec(kind).actions ?? {}));
  });

  it("finds an action only by its own name", () => {
    expect(actionOf("checkpoint", "loginTypes")).toBeTypeOf("function");
    expect(actionOf("checkpoint", "toString")).toBeUndefined();
    expect(actionOf("openvpn", "loginTypes")).toBeUndefined();
  });
});
