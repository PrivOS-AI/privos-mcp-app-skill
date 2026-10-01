# Manifest and scopes

`privos-app.json` at the repository root is the only manifest. A server app reads it on
every call (`src/manifest.ts`), so the paired announcement, `tools/list`, the served
`/.well-known/mcp/manifest.json` and the tests all agree. Do not keep a second copy.

The SDK lint (`npm run manifest:lint:publish`) is weaker than the marketplace check. A
manifest can pass the lint and still be refused at upload, so the rules below are the ones
to follow, and `scripts/preflight.mjs` checks them.

## Fields

| Field | Rule |
|---|---|
| `schemaVersion` | `3` |
| `kind` | `"mcp-app"` |
| `name` | The app id. `^[a-z0-9][a-z0-9._-]{1,127}$`. Equals `package.json` `name`, is the host of every `ui://` URI, and derives the marketplace listing slug |
| `version` | Semver. Equals `package.json` `version` |
| `title` | 2 to 100 characters |
| `description` | 10 to 2000 characters |
| `author` | An object with a `name` (required, at most 100 characters); `email` and `website` optional |
| `tools` | Server apps. Each tool: `name`, `title` (required), `description`, `inputSchema`, optional `ui` |
| `ui.entryPoints` | INSTANT apps (and optional for others): `roomTab`, `sidebar`, `standalone` |
| `permissions` | The scopes the app needs, see below |
| `dataPolicy` | Required for every app except INSTANT |
| `stateless` | Required boolean for every app except INSTANT |
| `port`, `resources`, `volumes` | Server apps. `port` 1024 to 65535 |
| `capabilities.verifiedActor` | `true` when a tool needs the acting user, see [server-and-auth.md](server-and-auth.md) |
| `license.tiers` | Optional licence tiers, see [server-and-auth.md](server-and-auth.md#licensing) |
| `executionMode` | `"INSTANT"` for a UI-only app; absent otherwise |

Unknown keys are refused, at the top level and inside a tool. A tool accepts `name`, `title`,
`description`, `inputSchema` and `ui`; `ui` accepts `resourceUri`, `permissions`, `csp` and
`hideAiChat`. Do not add `runtimeTrustProvisioningUrl`: it is not a field of a marketplace or
Relay manifest.

A tool `name` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and is unique. A `resourceUri`
is `ui://<app id>/<file>.html`; the file name matches `[A-Za-z0-9][A-Za-z0-9._-]*\.html`.

## Permissions

```json
{
  "scope": "lists:read",
  "requirement": "optional",
  "context": "room",
  "executionContext": "user",
  "feature": "lists.overview",
  "reason": "Show the lists of the room the dashboard is open in.",
  "degradedBehavior": "The dashboard still opens, but it does not list the room's lists until this access is granted."
}
```

| Field | Rule |
|---|---|
| `scope` | A scope from [permission-catalog.md](permission-catalog.md); one entry per scope |
| `requirement` | `required` or `optional` |
| `context` | `workspace` or `room`, one the catalog lists for the scope |
| `executionContext` | `user`, `background` or `both`, one the catalog lists for the scope |
| `feature` | `^[a-z0-9][a-z0-9._-]{1,127}$`, unique across the manifest |
| `reason` | 10 to 1000 characters; say what the app does with the access, for the admin who approves it |
| `degradedBehavior` | Required when `requirement` is `optional`; 10 to 1000 characters; forbidden when `required` |

A required scope that is refused blocks the install. An optional scope must describe the app's
real reduced behavior, and the UI and tools must actually behave that way (see
[ui.md](ui.md)).

## Declaring the scopes an app really uses

Every host tool the UI calls needs its scope declared, or the Hub refuses the call at run
time. List the host tools the UI calls (hooks, `usePrivosTool`, `app.rest`, `app.uploadFile`),
find each scope in [ui.md](ui.md#hooks-and-the-scopes-they-need) or `host-tools.json`, and
declare it. Declare nothing the app does not call. Scope-free calls (`usePrivosContext`,
`app.storage`) need no entry; the scaffold still declares `basic:information` as required.

## Data policy

```json
"dataPolicy": {
  "version": "2026-10-01",
  "retention": "What the app keeps and for how long, in at least 10 characters.",
  "externalProcessing": false
}
```

`externalProcessing: true` also needs a non-empty `externalDestinations` list.
`dataCategories` and `residency` are optional. Write the policy from what the app really does.

## Stateless and volumes

`stateless: true` with `volumes: []` for an app that keeps nothing. `stateless: false` needs
exactly one volume named `data` with a `mountPath`.

## Licence tiers

`license.tiers` is a list of `{ id, name, features, limits? }`; `id` matches
`^[a-z0-9][a-z0-9._-]{0,63}$`, ids are unique, and there are at most 20 tiers.

## Changing the manifest

- Bump `version` in both `privos-app.json` and `package.json` for any release; they must
  agree, and a published version number cannot be reused.
- On a paired app, an edit is reported on `/ready` as `MANIFEST_DRIFT` until an admin clicks
  **Refresh** and **Approve update** in the app's settings. No re-pairing and no restart.
- `ui://` URIs must keep the app id as their host when the id changes.

## Checks, in order

```bash
npm test
npm run manifest:lint:publish
npm run publish:marketplace -- --dry-run      # run it twice; nothing is uploaded
node <skill dir>/scripts/preflight.mjs
```

The dry run needs a committed, clean tree (it refuses otherwise). Plain `lint` has been seen
to pass a manifest that `publish` rejects, so the dry run is the real local gate.

Sources: the marketplace manifest checks, the SDK lint in `@privos_ai/app-server`, the
[developer guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/developer-guide.md)
and [INSTANT apps](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/instant-apps.md).
