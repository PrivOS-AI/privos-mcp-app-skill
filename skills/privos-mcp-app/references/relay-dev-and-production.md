# Relay: development and production

Relay is one path. The app runs on a machine you control and connects to the workspace over a
Relay connection. The same protocol, the same signed dispatch, the same verified caller and the
same permission approval apply whether you are developing the app or running it in production.
The Hub makes no difference between the two. There is no dev variant: one app id, one
pairing, one identity file.

## Why Relay is the development path

Pairing once takes far less procedure than a marketplace upload and review. You see the app in
a real workspace, with the real identity and scopes, while you build it. When it is finished,
the same paired app keeps running as production on a host that stays up. What changes between
the two uses is how and where you run the process, not anything the workspace sees.

## What the workspace admin does

The admin needs to do one of these, then approve:

- **Pair first.** In Admin > Apps choose **Add Standalone Relay App**. The Hub creates a
  one-time pairing URL at once (valid one hour) of the shape
  `wss://<hub>/api/v1/mcp-apps.relay?pair=<token>`. The app announces its own
  `privos-app.json` when it pairs, so no manifest URL is entered.
- **Install from the manifest.** An admin with the right permission installs the app from its
  `privos-app.json` and then generates a pairing URL from the app's settings.

Either way the admin then approves the permissions the app announces (required permissions
cannot be cleared), and keeps the **Hub fingerprint** for the check below. The admin gets the
fingerprint from the response that creates the pairing URL, or from
`GET /api/v1/mcp-apps.standalone.fingerprint`; recent Hub versions do not show it on the admin
screen. Full admin steps: [admin guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/admin-guide.md#relay-app-via-admin-portal--auto-pairing).

## Pair: `npm run pair`

The developer runs it in their own terminal and pastes the URL when asked. The URL is read from
standard input, so it never reaches shell history or a command line. The agent never asks for
it in the conversation.

```bash
npm run pair
```

One run does it all: it registers the app, prints the Hub fingerprint, waits until an admin
approves the permissions, then writes `privos-standalone-identity.json` (mode 0600). There is no
second pairing step. If it is interrupted before approval it leaves
`privos-standalone-identity.pending.json` behind and refuses to start again; see
[troubleshooting.md](troubleshooting.md).

## Compare the fingerprint

The fingerprint the app prints must equal the one from the admin side, compared over another
channel such as a call or a separately verified chat. It is the same trust decision as accepting
an SSH host key: if the two differ, the admin must not approve and the developer must stop.

## The dev loop: `npm run dev`

Runs the paired app in watch mode with signed dispatch and a verified caller. The workspace
page loads the UI live from a Vite server, so a UI edit appears without a rebuild.

- The browser that shows the workspace must run on the machine that runs `npm run dev`, or
  reach port 5173 through a forwarded port. For a forwarded or tunnelled origin set
  `PRIVOS_DEV_UI_ORIGIN`.
- A host that exports `PORT` or `NODE_ENV=production` changes the start: use
  `env -u PORT -u NODE_ENV npm run dev`.
- The watcher does not restart when the identity file changes.
- Without an identity file, a server app's dev loop starts in loopback mode: unsigned, no
  verified caller. It is useful for tools that need no caller, and it is not a workspace test.

### INSTANT apps

An INSTANT app has no server, and a workspace finds the UI of a Relay tab through a tool that
points at it. So `npm run dev` runs `scripts/dev-relay.ts`, a dev-only server that pairs a relay
manifest made of `privos-app.json` plus one UI tool per `ui.entryPoints` entry, built in
memory, and serves the UI live. `privos-app.json` stays tool-free, and the marketplace sees
only that file. `npm run pair` builds the same relay manifest, so the pinned manifest does not
drift on its own; a real edit of `privos-app.json` does, and needs Refresh and Approve update.
The preview serves one UI page, so every entry point uses the same `ui://` URI. It listens on
`PORT`, else 3001. The pairing, the fingerprint check and the approval are the same as above.

## Production: `npm run build` and `npm start`

```bash
npm run build
npm start
```

This is for server apps. An INSTANT app has no `npm start`: its production path is the
marketplace ([marketplace-submission.md](marketplace-submission.md)).

The same app, the same pairing and the same identity file; `npm start` serves the built UI.
Nothing is paired again and the workspace does not change. Run it under a supervisor on a host
that stays up.

### The identity file

It holds the current approval. The Hub rewrites it on approval and on every Relay reconnect.

- Keep it at an **absolute, persistent path** outside your build output and point
  `PRIVOS_STANDALONE_IDENTITY_FILE` at it. The default is `./privos-standalone-identity.json`
  in the working directory, which breaks when the process starts from another directory.
- **Never commit it, copy it or bake it into an image.** A redeploy that copies a stale file
  over the live one makes every dispatch fail with `Authenticated private dispatch required`
  until the next reconnect heals it.
- **One process per app id.**
- It is relay credentials and dispatch trust: never put its contents in an environment file.

### Clocks

The Hub signs each dispatch with a 30-second lifetime, and skew tolerance is a few seconds.
Run NTP on the app host, or dispatch fails intermittently and looks like a network problem.

## `/ready` and its reasons

`/health` is liveness. `/ready` reports readiness or a reason:

| Reason | Meaning |
|---|---|
| `IDENTITY_NOT_LOADED` | The identity file did not load (wrong path, wrong mode, missing) |
| `RELAY_NOT_AUTHENTICATED` | The Relay connection is not authenticated |
| `MANIFEST_LINT_INVALID` | The local manifest fails the lint |
| `MANIFEST_DRIFT` | The local manifest differs from the approved one |

An unpaired production start answers 503 with `PRODUCTION_WITHOUT_IDENTITY` and serves the
manifest only.

## Changing the manifest

Edit `privos-app.json` (and bump `version` in both files). `/ready` reports `MANIFEST_DRIFT`
from then until an admin opens the app's settings, clicks **Refresh**, reviews the diff,
ticks the permissions to allow and clicks **Approve update**. The running app then becomes
ready without a restart. If the app was offline at that moment, use **Redeliver trust** after
it reconnects. Do not let an orchestrator restart-loop on the readiness probe during an
update. Re-pairing a live app is refused, and is never needed for a manifest change.

## Pairing again after an uninstall

Uninstall removes the app from the workspace, including its room bindings and agent bot. To
come back: delete the old identity file on the app host, get a new pairing URL and run
`npm run pair`. Without deleting the file, pairing stops with `IDENTITY_FILE_ALREADY_EXISTS`.

## One app id, once per workspace

An app id is live once per workspace by either route. A live Relay copy, or a registration that
was paired but never approved, makes a marketplace install of the same id fail with
`mcp_app_id_conflict`. So uninstall the Relay copy before installing the same app from the
marketplace in that workspace. A fully uninstalled Relay copy is taken over by the marketplace
install.

Sources: [install and operate your own MCP app](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/install-and-operate-your-own-mcp-app.md),
[developer guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/developer-guide.md#4-develop-over-relay),
and the scaffold's `scripts/pair.ts` and `src/server.ts`.
