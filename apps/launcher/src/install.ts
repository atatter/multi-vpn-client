import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { archiveUrl, executableIn, type Manifest } from "./release.ts";

interface InstallOptions {
  manifest: Manifest;
  /** "linux-x64" etc., see targetOf. */
  target: string;
  /** versionsDir: one folder per unpacked version. */
  dir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

/** Reads a small system file, or undefined where it doesn't exist. */
export function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Makes sure this launcher's version is unpacked and returns its executable. The archive is downloaded, checked
 * against the manifest's checksum, unpacked into a temporary folder and only then renamed into place, so a version
 * folder that exists is always complete.
 */
export async function ensureInstalled({ manifest, target, dir, platform, env, log }: InstallOptions): Promise<string> {
  const archive = manifest.archives[target];
  if (!archive) throw new Error(`Multi VPN Client ${manifest.version} isn't available for ${target}. It's built for ${Object.keys(manifest.archives).join(", ")}.`);
  const versionDir = join(dir, manifest.version);
  if (existsSync(executableIn(versionDir, platform))) return executableIn(versionDir, platform);

  await mkdir(dir, { recursive: true });
  const work = await mkdtemp(join(dir, ".download-"));
  try {
    const file = join(work, archive.file);
    log(`Downloading Multi VPN Client ${manifest.version}…`);
    const sha256 = await download(archiveUrl(manifest, archive, env), file);
    if (sha256 !== archive.sha256) throw new Error(`The download of ${archive.file} doesn't match its checksum, so it wasn't opened. Try again; if it keeps happening, report it.`);

    const unpacked = join(work, "unpacked");
    await mkdir(unpacked);
    await extract(file, unpacked, platform, env);
    const root = await singleFolder(unpacked);
    if (!existsSync(executableIn(root, platform))) throw new Error(`${archive.file} doesn't contain the app where it should be.`);
    await rename(root, versionDir).catch((error: unknown) => {
      // Another launcher finished the same version first; theirs is just as good.
      if (!existsSync(executableIn(versionDir, platform))) throw error;
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  await removeOtherVersions(dir, manifest.version);
  return executableIn(versionDir, platform);
}

/**
 * GETs `url`, following redirects: GitHub serves release assets from another host. Node's http rather than fetch,
 * whose client can crash the process when a server closes the connection while a download waits on the disk.
 */
function request(url: string, redirects = 5): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith("https:") ? httpsGet : httpGet;
    get(url, (response) => {
      const { statusCode = 0, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        if (redirects === 0) reject(new Error(`Downloading ${url} failed: too many redirects.`));
        else resolve(request(new URL(headers.location, url).toString(), redirects - 1));
      } else if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Downloading ${url} failed: HTTP ${statusCode}.`));
      } else resolve(response);
    }).on("error", (error) => reject(new Error(`Downloading ${url} failed: ${error.message}. Check the internet connection and try again.`)));
  });
}

/** Streams `url` into `file` and returns its SHA-256. */
async function download(url: string, file: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(
    await request(url),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(file),
  );
  return hash.digest("hex");
}

/**
 * Unpacks with the system's tar: GNU or BSD tar on macOS and Linux, and on Windows the bsdtar that ships in System32
 * (it reads zip too). The full path matters there: Git for Windows puts a GNU tar on PATH that can't read zip.
 */
function extract(file: string, into: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<void> {
  const tar = platform === "win32" ? join(env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  return new Promise((resolve, reject) =>
    execFile(tar, ["-xf", file, "-C", into], { maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) =>
      error ? reject(new Error(`Unpacking ${file} failed: ${stderr.trim() || error.message}`)) : resolve(),
    ),
  );
}

/** Archives wrap the app in one folder (Linux, "multi-vpn-client-1.2.3-linux-x64/") or not (a macOS .app); either way, the folder holding the app. */
async function singleFolder(dir: string): Promise<string> {
  const entries = await readdir(dir);
  const [only] = entries;
  if (entries.length === 1 && only && !only.endsWith(".app") && (await stat(join(dir, only))).isDirectory()) return join(dir, only);
  return dir;
}

/** Best effort: a version that's still running may not be removable (Windows), and that's fine. */
async function removeOtherVersions(dir: string, keep: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    if (entry !== keep && !entry.startsWith(".")) await rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
  }
}
