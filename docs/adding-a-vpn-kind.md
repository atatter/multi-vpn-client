# Adding a VPN type

Each VPN type is an integration: its own folder in `packages/vpns/src/integrations/`. Copy the closest one and change it.

## 1. Add the files

- `kind.ts`: what the VPN saves, like its server and username.
- `engine.ts`: how to start its client.
- `container.ts`: the Docker image its client runs in. Skip it if the client is already in `shared/` (code that several integrations use).
- `form.tsx`: its name and the fields the user fills in.

`kind.ts` runs everywhere, `.tsx` files run in the window, and every other `.ts` file runs in the engine. An integration never imports another one, only `shared/`.

## 2. Register it

Add it to each of these, in `packages/vpns/src/`:

- `index.ts`
- `engine.ts`
- `ui.ts`

The build fails until all three are there.

## 3. Follow the rules

- List every server it connects to in `hosts`. A missing one can break the user's network.
- Put passwords and keys in `secrets`, never in the settings. The login password is `PASSWORD_SLOT`.
- Give the client each setting as its own argument, and passwords as files. Never put a password in a shell command, an environment variable or an argument.
- Add an integration only when it works: it has connected to a real server. Nothing half-built goes in.
- A new setting on a VPN type users already have needs a default value.
- Call the username field `username` and the certificate pin `serverCertPin`, so the app handles them.

## 4. Write the start script

The start script in `container.ts` must:

- send all traffic into the tunnel, except traffic to the VPN server and to Docker;
- run `mvpn-ready` once the tunnel works;
- write the DNS servers to `/run/mvpn/pushed-dns`, the server it connected to to `/run/mvpn/endpoint`, and the routes the server sent to `/run/mvpn/pushed-routes` (if the client can't tell, skip the routes and set `followsServerRoutes: false`);
- print `SH_MARKERS.error` from `@repo/vpn-sdk/container` (`TCL_MARKERS.error` in an expect script) followed by a message when it fails, and the matching `prompt` marker followed by a question to ask the user something; the answer arrives in `/run/mvpn/answers`. The markers carry a per-connect nonce, so a hand-written `MVPN-ERROR:` line is ignored.

## Optional

- Recognise it from an address: add `detect` in `engine.ts`.
- Create it from a provider's file: add `fromFile` in `kind.ts`.
- Let its form ask the engine something, like Check Point's login types: declare it in `kind.ts`, build it in `engine.ts` with `implement`, and call it from `form.tsx` with `callAction`.
