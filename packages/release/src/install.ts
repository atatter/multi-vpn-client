import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { archiveUrl, compareVersions, executableIn, isVersion, type Manifest } from "./release.ts";

interface InstallOptions {
  manifest: Manifest;
  /** "linux-x64" etc., see targetOf. */
  target: string;
  /** versionsDir: one folder per unpacked version. */
  dir: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The share of the archive downloaded so far, from 0 to 1. */
  onProgress?: (share: number) => void;
}

/**
 * Makes sure the manifest's version is unpacked and returns its executable. The archive is downloaded, checked
 * against the manifest's checksum, unpacked into a temporary folder and only then renamed into place, so a version
 * folder that exists is always complete. Other versions are left alone: one of them may be running.
 */
export async function ensureInstalled({ manifest, target, dir, platform, env, onProgress }: InstallOptions): Promise<string> {
  const archive = manifest.archives[target];
  if (!archive) throw new Error(`Multi VPN Client ${manifest.version} isn't available for ${target}. It's built for ${Object.keys(manifest.archives).join(", ")}.`);
  const versionDir = join(dir, manifest.version);
  if (existsSync(executableIn(versionDir, platform))) return executableIn(versionDir, platform);

  await mkdir(dir, { recursive: true });
  const work = await mkdtemp(join(dir, ".download-"));
  try {
    const file = join(work, archive.file);
    const sha256 = await download(archiveUrl(manifest, archive, env), file, (received, length) => onProgress?.(received / (length ?? archive.size)));
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
  return executableIn(versionDir, platform);
}

/** The versions in `dir` that are completely unpacked, in no particular order. */
export async function installedVersions(dir: string, platform: NodeJS.Platform): Promise<string[]> {
  const entries = await readdir(dir).catch(() => []);
  return entries.filter((entry) => isVersion(entry) && existsSync(executableIn(join(dir, entry), platform)));
}

/**
 * Removes the versions older than `version`. Only the app calls it, for its own version, once it holds the
 * single-instance lock: then no older version can be running. Best effort, as a Windows file may still be in use.
 */
export async function removeOlderVersions(dir: string, version: string): Promise<void> {
  for (const entry of await readdir(dir).catch(() => [])) {
    if (isVersion(entry) && compareVersions(entry, version) < 0) await rm(join(dir, entry), { recursive: true, force: true }).catch(() => undefined);
  }
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

/** Streams `url` into `file`, reporting the bytes received and the response's length, and returns its SHA-256. */
async function download(url: string, file: string, onProgress: (received: number, length: number | undefined) => void): Promise<string> {
  const hash = createHash("sha256");
  const response = await request(url);
  const length = Number(response.headers["content-length"]) || undefined;
  let received = 0;
  await pipeline(
    response,
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        received += chunk.length;
        onProgress(received, length);
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
