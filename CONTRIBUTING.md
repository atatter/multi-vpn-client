# Contributing

Thanks for helping. Bug reports and fixes are the most welcome, and the most likely to be merged.

Review time is limited. Opening a pull request doesn't oblige anyone to review or merge it: it may be closed, narrowed down, or the idea done differently later.

## Before you start

For anything bigger than a small fix, such as a new feature or a new VPN kind, open an issue first and say what you want to change. Agreeing on the approach up front saves you from writing a pull request that doesn't fit.

Never put real gateway addresses, usernames, passwords or unedited logs in issues or pull requests. Use placeholders like `vpn.example.com`. Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Making a change

Setting up, running the app and the checks a change must pass are in the [README](README.md#working-on-it). [AGENTS.md](AGENTS.md) holds the project's rules and its traps, such as not writing to your live config and not killing your own VPN connections. It's written for coding agents, but it applies to people too. Adding a VPN kind has its own guide: [docs/adding-a-vpn-kind.md](docs/adding-a-vpn-kind.md).

## Showing it works

Say how you found the problem, what you checked, and what you saw: the focused tests you ran, the manual steps, and on which OS and VPN type. Say what you couldn't check, such as a real gateway or another OS. "Tests pass" alone doesn't show that the change works.

Changes to the window need before and after screenshots, and a short recording when something moves. Attach them to the pull request; don't commit them.

## Pull requests

- One problem per pull request. A second fix or an unrelated cleanup goes in its own.
- The title is a conventional commit in plain language that says what changed for the user, e.g. `fix(desktop): connecting from a VPN's page no longer leaves unsaved changes behind`.
- Fill in the template: the problem, the change, and how you checked it. If an AI agent wrote the change, say which one.

The maintainer reviews every pull request and decides what gets merged.

By contributing, you agree that your contribution is licensed under the [MIT license](LICENSE).
