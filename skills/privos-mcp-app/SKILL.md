---
name: privos-mcp-app
description: Build a PrivOS MCP app from an idea. Use when the user asks for an app, tool, room tab, dashboard or UI that runs inside a PrivOS workspace, to develop it in their own workspace over Relay, to run it in production on Relay, or to prepare it for the PrivOS Marketplace — including checking whether an existing app (scaffolded or not) is ready to upload, or why an upload or marketplace build failed. Do not use for a generic MCP server that has nothing to do with PrivOS.
license: MIT
metadata: { tested-with: "create-privos-mcp-app 0.6.0, @privos_ai/app-server 0.12.3, @privos_ai/app-react 0.8.0, Claude Code 2.1.284" }
---

# PrivOS MCP app

Takes an idea to a PrivOS MCP app: scaffold, connect to the user's own workspace over
Relay while building, test, and then either keep it running on Relay (self-hosted) or
prepare it for the PrivOS Marketplace.

Relay is one path with one protocol for development and for production. The Hub makes no
difference between an app being developed and one in production. There is no dev variant:
no second app id, no second pairing, no second identity file.

## Rules that hold in every step

1. **Pairing is the user's action.** The user runs `npm run pair` in their own terminal and
   pastes a pairing URL from their workspace admin. Never ask for that URL in the
   conversation, never pass it on a command line, never read, print or commit the
   identity file (`privos-standalone-identity.json`) or any token. If pairing is not
   possible now, continue with the local loop and report the workspace check as pending.
2. **Identity comes from the verified context.** A tool takes the user and the room only
   from `context.actor` and `context.roomId`, never from its arguments, and refuses when
   there is no actor. Details: [server-and-auth.md](references/server-and-auth.md).
3. **Run the CLI through the app's npm scripts.** Never hand the unscoped name
   `privos-app` to a package runner. Outside an app use
   `npx -p @privos_ai/app-server privos-app ...`. Never pass `--portal` or set
   `PRIVOS_PORTAL_ORIGIN` unless the user names a portal.
4. **Publish only when the user asks.** Everything up to a dry run is safe; an upload is not.
5. **A skipped check is reported as skipped, never as passed.** A check that cannot run
   (no docker, no pairing) stays on the final report as pending.
6. **Nothing secret in UI code.** The UI bundle and every `VITE_*` value are public.
7. **Do not implement `/.well-known/mcp/register`** and do not build on any user token a
   UI could read. Reasons in [server-and-auth.md](references/server-and-auth.md).
8. **Headless runs.** If nobody can answer a question, state the assumption and continue.
   Keep the list of assumptions for the final report.
9. **Shell hygiene.** A host that exports `PORT` or `NODE_ENV=production` changes how the app
   starts and skips development dependencies: use `npm install --include=dev` and start
   the dev loop with `env -u PORT -u NODE_ENV npm run dev`.

## Workflow

### 1. Intake

Restate the brief in a short table before writing code: **tools** (name, what it does),
**UI surfaces** (room tab, sidebar, standalone page), **data** (what is stored and where),
**scopes** (which host data it reads or writes). Ask only about a decision you cannot
infer; for everything else state the assumption and continue. The brief goes into the
app's `README.md` once the app exists (step 3).

### 2. Choose the production target

Development always happens over Relay. Choose how the finished app runs:

| Target | Pick it when | Shape |
|---|---|---|
| **Relay (self-hosted)** | The user runs the server themselves, for their own workspace | Server app, paired, runs with `npm start` |
| **INSTANT** | The app is a UI over data that PrivOS Lists can hold, with no server-side work | UI only, no server. Workspace preview over Relay while building; production is the marketplace |
| **Managed Runtime** | The app needs a server and is distributed through the marketplace | The same server app as Relay, run by the platform |

One server app serves both Relay and managed Runtime. Default to a server app when the
brief needs a tool, a background job, a third-party call or its own data. Full comparison
and limits: [app-kinds.md](references/app-kinds.md).

### 3. Scaffold

Run in a directory that is not inside another repository (the app is its own repo root):

```bash
npx create-privos-mcp-app@^0.6.0 <name> --template default --id <your id>   # or --template instant
cd <name>
npm install --include=dev
git status          # review what the scaffold created
git add -A && git commit -m "Initial commit"    # package-lock.json included
```

Pick an id you own, for example a reversed domain (`com.acme.tasks`). Without `--id` the id
is `com.example.<name>` and must be replaced before publishing. Files produced:
`privos-app.json`, `package.json`, `src/` (server tools and UI), `tests/`, and for the
server template a `Dockerfile` and `scripts/pair.ts`. Never hand-write a skeleton.

### 4. Connect the app to the workspace over Relay

Ask the user to get a one-time pairing URL from their workspace admin, then to run in their
own terminal:

```bash
npm run pair      # paste the URL when asked; it is read from stdin
```

The command registers the app, prints the **Hub fingerprint**, and waits until an admin
approves the permissions the app announces. The user compares the fingerprint with the
admin over another channel. It ends by writing `privos-standalone-identity.json` (ignored
by git). Then run the paired app with a live UI:

```bash
env -u PORT -u NODE_ENV npm run dev     # long-running; keep it in its own terminal or session
```

Check `GET /ready` on the app's port (`port` in `privos-app.json`; 3001 for an INSTANT preview, or `PORT` when set). It reports ready once the
app is paired, connected and its manifest matches the approved one, and a reason otherwise; the reasons are in
[relay-dev-and-production.md](references/relay-dev-and-production.md). A browser on another
machine needs `PRIVOS_DEV_UI_ORIGIN`. An INSTANT app uses the same two commands: `npm run dev`
runs `scripts/dev-relay.ts`, which pairs a relay manifest (`privos-app.json` plus one UI tool per
`ui.entryPoints` entry, built in memory) so the workspace tab renders the live UI;
`privos-app.json` stays tool-free ([app-kinds.md](references/app-kinds.md#instant-details)). Without an
identity file, `npm run dev` runs in loopback mode with no verified caller and nothing in a
workspace can reach it: continue there and mark the workspace check pending.

### 5. Manifest

Edit `privos-app.json` (the only manifest; the server and the pairing read it). Apply the
stricter marketplace rules and declare every scope the tools and the UI use, each with a
valid context from [permission-catalog.md](references/permission-catalog.md). Then:

```bash
npm run manifest:lint:publish
```

On a paired app a manifest change makes `/ready` report `MANIFEST_DRIFT` until the admin
clicks **Refresh** and **Approve update** in the app's settings; the running app then
becomes ready without a restart. Rules and fields:
[manifest-and-scopes.md](references/manifest-and-scopes.md).

### 6. Server tools (server apps)

Add each tool to the manifest `tools` list and a handler in `src/tools.ts`. The handler
signature is `(args, context)`. Take the caller from `context.actor` and the room from
`context.roomId`, fail closed without an actor, and declare `capabilities.verifiedActor: true`
so managed dispatch carries the user. Add tests for the tool, including a **wrong room**
(an argument that names another room is ignored) and a **missing actor** (refused).
INSTANT apps have no tools: skip to step 7.

### 7. UI

Edit `src/ui/`. Wrap the app in `PrivosAppProvider`; read optional data only when
`usePrivosCapability(scope).granted`. Every host tool the UI calls needs its scope declared,
and `useFiles` calls a host tool that does not exist: use
`usePrivosTool('privos.files.getByChannel', { channelId })` instead. Hook-to-scope table,
theme, CSP and what must never be in UI code: [ui.md](references/ui.md).

### 8. Licensing (only when the brief has tiers)

Declare tiers in `license.tiers` of the manifest. Guards in the app must fail closed to the
free tier when no licence is present or it is invalid. How a licence reaches a running app
is not documented: say so in the report instead of inventing a mechanism.
See [server-and-auth.md](references/server-and-auth.md#licensing).

### 9. Tests

```bash
npm test
npm run typecheck
npm run build
```

The scaffold ships tests for the manifest and, for server apps, the tools. Extend them with
each tool and each scope-dependent UI state. Do not weaken a failing test.

### 10. Preflight

```bash
node <skill dir>/scripts/preflight.mjs      # <skill dir> = the directory that holds this SKILL.md
```

Run it from the app's root directory, or pass the app directory as its argument. It mirrors what the
marketplace checks before and after approval: the manifest against the Portal schema and the permission
catalog, the archive `git archive` produces, production dependency advisories (`npm audit`), the build,
and the bare hardened image serving its manifest within 30 s. It prints one line per check and exits 0 when all
pass, 2 when a check failed, 3 when a check was skipped. It works on an app that was not scaffolded too; for
one moving to the marketplace read [existing-app-to-marketplace.md](references/existing-app-to-marketplace.md). Fix failures and run it again. If it
exits 3, name each skipped check in the report (for example the docker check when docker is
not available) and do not call the app verified for that check.

### 11. Production on Relay

Server apps: the same app and the same pairing, run on a host that stays up. An INSTANT app has
no `npm start`; its production path is the marketplace (step 12).

```bash
npm run build
npm start
```

Keep the identity file on a persistent absolute path (`PRIVOS_STANDALONE_IDENTITY_FILE`), one
process per app id, correct clocks on the host. Nothing changes in the workspace. Details,
including re-pairing after an uninstall and the one-app-id-per-workspace rule:
[relay-dev-and-production.md](references/relay-dev-and-production.md).

### 12. Marketplace submission

Only INSTANT and managed Runtime apps go to the marketplace, and only when the user asks.
The command is `npm run publish:marketplace -- --dry-run` first, then
`npm run publish:marketplace`, which waits for browser approval by the listing owner. Hand the
actual publish to the `privos-app-publish` skill the scaffold placed in the app under
`.claude/skills/`. Explain three things before it runs:

- **`PUBLISHER_NOT_ENABLED`** (exit 2, nothing uploaded): publishing is open to enabled
  creators only. The app still runs in the user's workspace on Relay; do not retry.
- **INSTANT listing mode**: the marketplace team sets it on the listing before the first
  upload of an INSTANT app.
- **Listing content gate**: a first version is refused with `LISTING_CONTENT_INCOMPLETE`
  until the listing has its categories, features, support and legal URLs, icon and
  screenshots.

Creator steps: [marketplace-submission.md](references/marketplace-submission.md).

## Final report

State: what was built (tools, UI, scopes), the commit, which checks passed, which were
skipped or pending (workspace check, docker check, marketplace), the assumptions made in a
headless run, and what the user must do next (pairing, approval, publishing).

## References

| File | Read it for |
|---|---|
| [app-kinds.md](references/app-kinds.md) | INSTANT, Relay and managed Runtime compared |
| [manifest-and-scopes.md](references/manifest-and-scopes.md) | Manifest fields and the stricter marketplace rules |
| [permission-catalog.md](references/permission-catalog.md) | Every scope and where it is valid |
| [server-and-auth.md](references/server-and-auth.md) | Tools, identity, licensing, secrets |
| [ui.md](references/ui.md) | Hooks, scopes, theme, what stays out of UI code |
| [relay-dev-and-production.md](references/relay-dev-and-production.md) | Pairing, dev loop, production, re-pairing |
| [marketplace-submission.md](references/marketplace-submission.md) | Creator steps and review |
| [existing-app-to-marketplace.md](references/existing-app-to-marketplace.md) | An app not built from the scaffold: SDK, startup, split UI, Dockerfile, archive |
| [troubleshooting.md](references/troubleshooting.md) | Symptom to cause to fix |

Data files: `references/permission-catalog.json` (scopes, contexts, catalog version) and
`references/host-tools.json` (UI hook, host tool, scope).

## Public documentation

Link to these instead of restating their API tables.

- [Developer guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/developer-guide.md)
- [Admin guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/admin-guide.md)
- [Install and operate your own MCP app](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/install-and-operate-your-own-mcp-app.md)
- [Publishing CLI](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/publishing-cli.md)
- [INSTANT apps](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/instant-apps.md)
- [React SDK reference](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/react-sdk-reference.md)
- [Tools: context](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/apis/tools-context.md)
- [The signed UI bundle](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/ui-bundle.md)
- Reference apps: [server app](https://github.com/PrivOS-AI/privos-mcp-app-demo) and
  [INSTANT app](https://github.com/PrivOS-AI/privos-okr-instant-app)
