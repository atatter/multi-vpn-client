import { createHash } from 'node:crypto';
import { ENTRY, READY } from './entry-scripts.ts';
import { SING_BOX_MUSL_TARBALLS, SING_BOX_VERSION } from './sing-box-release.ts';

/**
 * The contract between the app and a VPN client's container (Node only): the marker lines it prints,
 * the scripts and sing-box every image carries, and how an image is written. Each client's own
 * image and start scripts live with it in @repo/vpns; docs/adding-a-vpn-kind.md says what a start
 * script must do.
 */

export * from './markers.ts';
export * from './shell-functions.ts';
export * from './sing-box-release.ts';

const b64 = (text: string) => Buffer.from(text).toString('base64');

/** Writes a script into the image: `echo … | base64 -d`, since a stdin build has no context to COPY from. */
export const install = (path: string, content: string) =>
  `echo ${b64(content)} | base64 -d > ${path}`;

/** Installs the pinned static sing-box; runs on any distro. */
export const INSTALL_SING_BOX = `RUN set -eu; \\
    case "$(uname -m)" in \\
      x86_64) arch=amd64; sha=${SING_BOX_MUSL_TARBALLS.amd64};; \\
      aarch64) arch=arm64; sha=${SING_BOX_MUSL_TARBALLS.arm64};; \\
      *) echo "unsupported architecture" >&2; exit 1;; \\
    esac; \\
    url="https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-$arch-musl.tar.gz"; \\
    curl -fsSL -o /tmp/sing-box.tgz "$url"; \\
    echo "$sha  /tmp/sing-box.tgz" | sha256sum -c -; \\
    tar -xzf /tmp/sing-box.tgz -C /tmp; \\
    mv "/tmp/sing-box-${SING_BOX_VERSION}-linux-$arch-musl/sing-box" /usr/local/bin/sing-box; \\
    rm -rf /tmp/sing-box*`;

/**
 * Installs the entry point, READY and the given client scripts (path, content), so each image
 * carries (and is hashed over) only what its clients run.
 */
export const installScripts = (...scripts: (readonly [path: string, content: string])[]) => {
  const all = [
    ['/usr/local/bin/mvpn-entry', ENTRY],
    ['/usr/local/bin/mvpn-ready', READY],
    ...scripts,
  ] as const;
  return `RUN sing-box version && \\
${all.map(([path, content]) => `    ${install(path, content)} && \\`).join('\n')}
    chmod 755 ${all.map(([path]) => path).join(' ')}
ENTRYPOINT ["/usr/local/bin/mvpn-entry"]`;
};

/** A VPN container image, built locally from its Dockerfile on first use. */
export interface VpnImage {
  tag: string;
  dockerfile: string;
}

/** Every VPN image's name starts with this, which is how uninstall finds them all, older builds included. */
export const VPN_IMAGE_PREFIX = 'mvpn-';

/** Content-addressed, so changing the Dockerfile rebuilds automatically. */
export const vpnImage = (
  name: `${typeof VPN_IMAGE_PREFIX}${string}`,
  dockerfile: string,
): VpnImage => ({
  tag: `${name}:${createHash('sha256').update(dockerfile).digest('hex').slice(0, 12)}`,
  dockerfile,
});

/** vpcd's port for its first reader slot (its default, 0x8C7B); the second slot uses the next one. */
export const VPCD_PORT = 35963;

/**
 * The loopback address the relay connects to vpcd from. vpcd's port takes connections from it alone,
 * so nothing else in the container (e.g. its SOCKS proxy) can pose as the card.
 */
export const VPCD_RELAY_SOURCE = '127.0.0.3';
