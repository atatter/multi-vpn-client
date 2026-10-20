import { type Detection, kindSpec, newVpn, type Vpn } from "@repo/core";
import { nameFromAddress, uniqueName } from "../domain/names.ts";

/** A new VPN's draft for what an address turned out to be. */
export function draftFor(detection: Exclude<Detection, { kind: "unknown" }>, vpns: readonly Vpn[]): Vpn {
  const draft = newVpn(detection.kind, { id: crypto.randomUUID(), name: uniqueName(nameFromAddress(detection.address), vpns) });
  return kindSpec(detection.kind).withAddress(draft, detection.address);
}
