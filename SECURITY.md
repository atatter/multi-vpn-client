# Security

Multi VPN Client changes your machine's routes and DNS through a background helper with administrator rights, and it stores VPN passwords. Please report security problems privately, so they can be fixed before anyone else hears about them.

## Reporting a vulnerability

Use [Report a vulnerability](https://github.com/atatter/multi-vpn-client/security/advisories/new) on the repository's Security tab. Only the maintainers can see the report. Please don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. Leave out real gateway addresses, usernames and passwords; a placeholder like `vpn.example.com` is enough.

This is a side project, so replies are best effort. Fixes go into the latest release only.

## What counts

- Anything that lets someone else use the helper, or gain root through it.
- Saved passwords or tokens leaking.
- Traffic going somewhere other than where the app says it goes.
- A VPN container reaching the host or other containers in ways it shouldn't.

Problems in the VPN clients themselves (OpenVPN, OpenConnect, snx-rs) or in sing-box belong with those projects.
