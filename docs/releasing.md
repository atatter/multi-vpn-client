# Releasing

A release happens in two stages, with a stop for the owner's approval in between.

1. **Build.** You start the Release workflow. It builds and tests the app on macOS, Linux and Windows, then creates a **draft**: the GitHub Release as it will look, with its version, notes and files. Only maintainers can see a draft. Nothing is public yet.
2. **Publish.** The workflow stops until the repo owner, `atatter`, approves it. Only they can. Approving makes the draft public, which creates its `v*` tag, commits the new version to `main` (`chore: release <version>`), and publishes the npm package `multi-vpn-client`. Rejecting stops the run, and nothing goes out.

Every release has one version, shared by the app, the GitHub Release and the npm package. `version` in `apps/desktop/package.json` on `main` is the last released version, and the workflow raises it from there. Only the workflow changes it, so you never open a version-bump pull request.

## Cutting a release

1. Go to Actions → Release → **Run workflow**, choose `main`, and pick how much to raise the version: `patch`, `minor` or `major`. From v0.1.0 that gives v0.1.1, v0.2.0 or v1.0.0.
2. Wait for the builds, about 10 minutes. Open the draft from the link in the run's summary, or from the Releases page. Check the version, the notes (the pull requests merged since the last release) and the files.
3. `atatter` approves it: in the run, **Review deployments**, then **Approve and deploy**. If you started the release, ask them.
4. On a machine without the repo, run `npx multi-vpn-client@<version>`.

Running the workflow on any other branch only builds and tests. Pull requests that touch packaging run it too.

## When something goes wrong

- **A build or test failed:** no draft was made. Fix it on `main` and start again.
- **The draft is wrong:** cancel the run (`atatter` can also reject it under **Review deployments**). Delete the draft on the Releases page, fix the problem and start again. A run stops if a draft for its version already exists.
- **The release is public but npm publishing failed:** re-run the failed job. It's safe to re-run.
- **A published release is broken:** release a new version. Never replace a file on a published release: the npm package of that version checks downloads against the original checksums, so the launcher would refuse the new file.
