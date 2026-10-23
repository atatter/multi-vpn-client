# Releasing

A release is one version number for everything: the app, its archives, the GitHub Release and the npm package `multi-vpn-client`. Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds and smoke-tests the archives on each OS, creates the GitHub Release, and publishes the npm package once a maintainer approves.

## Cutting a release

1. Open a pull request that sets `version` in `apps/desktop/package.json`, e.g. `chore: release 0.2.0`. Merge it.
2. Tag the merge commit on `main` and push the tag:
   ```sh
   git tag v0.2.0 && git push origin v0.2.0
   ```
   The workflow fails at once if the tag and the version differ.
3. When the GitHub Release exists, approve the waiting `npm` deployment in the workflow run.
4. Check it like a user would, on a machine without the repo: `npx multi-vpn-client@0.2.0`.

To build and smoke-test the archives without releasing, run the Release workflow by hand on a branch (Actions → Release → Run workflow). Pull requests that touch packaging run it too. Nothing is published unless the run comes from a tag.

## When something goes wrong

- **Build or smoke test failed:** nothing was published. Fix it, delete the tag (`git push origin :v0.2.0`), and tag again.
- **The GitHub Release exists but npm publishing failed:** re-run the failed job. The archives stay as they are.
- **A published archive is broken:** release a new version. Never replace a release asset: the npm package of that version pins the old checksums, so the launcher would refuse the new file, and replacing assets is exactly what the pinned checksums guard against. Deprecating it doesn't help users who already updated: the launcher never starts a version older than one on disk.
- **The notices step fails after a Bun update:** `apps/desktop/scripts/notices.mts` needs the new version's WebKit and tinycc commits (`scripts/build/deps/{webkit,tinycc}.ts` at Bun's release tag) and its `LICENSE.md` in `apps/desktop/licenses/`.

## One-time setup

These live outside the repo, in npm's and GitHub's settings.

**GitHub**
- An environment named `npm` (Settings → Environments) with the maintainer as required reviewer, limited to tags matching `v*`.
- A tag ruleset that lets only maintainers create, move or delete `v*` tags.

**npm**
- The publishing account uses two-factor authentication with a security key.
- npm's trusted publishing can only be configured on a package that exists, so the first version is published by hand, as an empty placeholder:
  ```sh
  mkdir placeholder && cd placeholder
  npm init -y --init-version 0.0.0 && npm pkg set name=multi-vpn-client description="Not released yet."
  npm login && npm publish --access public && npm logout
  ```
- In the package's settings on npmjs.com:
  1. **Trusted Publisher:** GitHub Actions, repository `atatter/multi-vpn-client`, workflow `release.yml`, environment `npm`.
  2. **Publishing access:** "Require two-factor authentication and disallow tokens". From then on, only the release workflow can publish.
- Make sure no npm access tokens exist for the account (Access Tokens on npmjs.com).
