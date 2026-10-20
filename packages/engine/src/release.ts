import { SING_BOX_MUSL_TARBALLS, SING_BOX_VERSION } from "@repo/vpn-sdk/container";

/**
 * Host builds, keyed by `<node platform>-<go arch>`. `asset` is the release asset's name
 * suffix; `binary` is the SHA-256 of the extracted executable, checked on every use so a
 * cached copy can't be swapped. Linux uses the static musl build, so it runs on any distro.
 */
export const SING_BOX_HOST = {
  "darwin-arm64": {
    asset: "darwin-arm64.tar.gz",
    archive: "0360ce634a04c26a6b4fd957517987bb4f6c8950f63435ce3c5af2fcae5860c5",
    binary: "28b7200074d6380006acc4f035a404c8af3dceb65dd92d7386ed92c9224e08a2",
  },
  "darwin-amd64": {
    asset: "darwin-amd64.tar.gz",
    archive: "6d002b74d03b478547349cc10af89e007868596e5aa931816d45da9f544715a9",
    binary: "4d63d13fe7516a5d0a76c764095238f9d51ada7bfa5d18cf5030ca3032882c68",
  },
  "linux-amd64": {
    asset: "linux-amd64-musl.tar.gz",
    archive: SING_BOX_MUSL_TARBALLS.amd64,
    binary: "33de1654134de582a3d23786fdba32e5461bfe3eefe3e11ddeef2a9635a9e91c",
  },
  "linux-arm64": {
    asset: "linux-arm64-musl.tar.gz",
    archive: SING_BOX_MUSL_TARBALLS.arm64,
    binary: "beefed1a2ca95c6bd1719c2177af1009e9bef215294f71a7e187b66cbafc85e0",
  },
  "win32-amd64": {
    asset: "windows-amd64.zip",
    archive: "d8b86ef58936dba9230ec6a57ffa4243933f3c14ef4809828b6c553440ed1518",
    binary: "5c19bb3f8c12d4e85b3d47fe63123a7624b314b58dd7a8e32f51004f1c4d2faf",
  },
  "win32-arm64": {
    asset: "windows-arm64.zip",
    archive: "195b35424c6e3f5913954c7f08c5d8ba2d2199f6d18eb27a3972a5a29cdaa78c",
    binary: "db11afc05195e2e6484830a0a62050a22b3d488e080bfa8e21023e55ca3153d4",
  },
} as const;

export type SingBoxPlatform = keyof typeof SING_BOX_HOST;

/** The archive's single top-level folder, e.g. `sing-box-1.14.3-linux-amd64-musl`. */
export const singBoxFolder = (platform: SingBoxPlatform) =>
  `sing-box-${SING_BOX_VERSION}-${SING_BOX_HOST[platform].asset.replace(/\.(tar\.gz|zip)$/, "")}`;

export const singBoxUrl = (platform: SingBoxPlatform) =>
  `https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-${SING_BOX_HOST[platform].asset}`;
