import { z } from "zod";
import { Manifest } from "./release.ts";

/** npm's document for the newest published launcher: its package.json, which carries the release it starts. */
const LATEST_URL = "https://registry.npmjs.org/multi-vpn-client/latest";

const Latest = z.object({ release: Manifest });

/**
 * The newest release on npm, which stays the source of truth for what's out: it's what `npx multi-vpn-client`
 * starts. Errors are worded for the window, which shows them as they are.
 */
export async function latestRelease(url = LATEST_URL): Promise<Manifest> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => {
    throw new Error("Couldn't reach npm. Check the internet connection.");
  });
  if (!response.ok) throw new Error(`npm answered HTTP ${response.status}. Try again later.`);
  const parsed = Latest.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error("npm's newest version doesn't say what to download.");
  return parsed.data.release;
}
