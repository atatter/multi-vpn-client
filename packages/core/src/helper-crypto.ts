import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Node-only crypto for the helper handshake (see core/helper-protocol), shared
 * by the app and the helper so the two sides can't drift apart.
 * Import via "@repo/core/helper-crypto".
 */

/** The HMAC key both sides use, derived from the app's token. The helper stores this key (root-only), never the token. */
export const helperKey = (token: string) => createHash("sha256").update(token).digest();

export const signProof = (key: Buffer, message: string) => createHmac("sha256", key).update(message).digest("hex");

/** Constant-time comparison of two hex proofs. */
export function proofMatches(proof: string, expected: string): boolean {
  const [actual, wanted] = [Buffer.from(proof, "hex"), Buffer.from(expected, "hex")];
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
