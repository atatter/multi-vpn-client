/**
 * The pinned sing-box release, used inside every VPN container and, with the engine's host builds
 * (engine: release.ts), on the host. Archive digests are the SHA-256 GitHub publishes for each asset.
 */
export const SING_BOX_VERSION = "1.14.3";

/**
 * Statically linked (musl) Linux builds for the Alpine-based VPN containers.
 * The plain Linux builds need glibc's loader, which Alpine doesn't have.
 */
export const SING_BOX_MUSL_TARBALLS = {
  amd64: "41fc81fd041134d4d7d850a928d7d2cde17a7d6563953f406b22d32a68bfab1f",
  arm64: "12d6d67a4edf0dd54590865b1f4f79cd09ae043a02d648e9d1b5fccc8446ee07",
} as const;
