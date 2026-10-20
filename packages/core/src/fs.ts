import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname } from "node:path";

/** Parsed JSON at `path`, or undefined when the file doesn't exist. Other errors propagate. */
export async function readJsonIfExists(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Windows refuses to replace a file another process (CLI, antivirus) briefly holds open. */
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

/** Writes `value` as JSON via temp file + rename, so a crash can't leave half a file. */
export async function writeJsonAtomic(path: string, value: unknown, mode = 0o644): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
    await chmod(temp, mode);
    for (let attempt = 1; ; attempt++) {
      try {
        return await rename(temp, path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (attempt >= 5 || !TRANSIENT.has(code)) throw error;
        await sleep(50 * attempt);
      }
    }
  } finally {
    await rm(temp, { force: true });
  }
}
