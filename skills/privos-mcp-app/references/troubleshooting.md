# Troubleshooting

Symptom, cause, fix. Identity and pairing material (URLs, the identity file, tokens) is never
pasted into the conversation: describe what to check and let the user do it.

## Install and start

| Symptom | Cause | Fix |
|---|---|---|
| Build tools missing after `npm install` | The shell exports `NODE_ENV=production`, so dev dependencies are skipped | `npm install --include=dev` |
| App listens on an unexpected port, or the dev server will not start | The host exports `PORT` or `NODE_ENV=production` | `env -u PORT -u NODE_ENV npm run dev` |
| Port 5173 or the app port is in use | A stale process from an earlier run | Stop that process; do not start a second one on another port |
| `npm start` prints "The built UI is not usable" | `dist/` is missing or invalid | `npm run build`, then `npm start` |
| `npm start` serves only the manifest and `/ready` is 503 with `PRODUCTION_WITHOUT_IDENTITY` | Production start with no workload socket and no identity file | Pair the app (`npm run pair`) or point `PRIVOS_STANDALONE_IDENTITY_FILE` at the existing identity file |
| Tools answer "No verified caller" | The app runs in loopback development mode (not paired), or the Hub's signed caller is not reaching it | Pair the app; in a paired app check `/ready` and the clock |

## Pairing

| Symptom | Cause | Fix |
|---|---|---|
| `npm run pair` says the app is already paired | The identity file exists | To pair again: uninstall the app in the workspace, delete the identity file |
| `npm run pair` says an earlier pairing was never finished | `privos-standalone-identity.pending.json` exists | Remove the half-registered app in the workspace (Admin > Apps), delete that file, pair with a new URL |
| Pairing stops with `IDENTITY_FILE_ALREADY_EXISTS` | Old identity file after an uninstall | Delete it on the app host and pair again |
| The URL is refused | Pairing URLs are one-time and valid for one hour | Ask the admin for a new one |
| The fingerprints differ | The app reached something other than the expected Hub, or the wrong value was compared | Stop. The admin must not approve; start again from a fresh URL |
| `npm run pair` waits forever | No admin has approved the permissions | Ask the admin to approve in Admin > Apps |
| The Hub does not offer a new install | The admin setting for new standalone installs is off | Ask the workspace admin; existing installs keep working |

## Running over Relay

| Symptom | Cause | Fix |
|---|---|---|
| `/ready` 503 `IDENTITY_NOT_LOADED` | The identity file did not load: wrong path, wrong working directory, loosened mode | Use an absolute path in `PRIVOS_STANDALONE_IDENTITY_FILE`; the file must be mode 0600 |
| `/ready` 503 `RELAY_NOT_AUTHENTICATED` | The connection to the workspace is down or rejected | Check the network, the clock and that the app was not uninstalled |
| `/ready` 503 `MANIFEST_DRIFT` | `privos-app.json` differs from the approved manifest | Admin: app settings > **Refresh**, then **Approve update**. No restart is needed |
| `/ready` 503 `MANIFEST_LINT_INVALID` | The manifest fails the lint | `npm run manifest:lint:publish` and fix it |
| Every dispatch fails with "Authenticated private dispatch required" | A stale identity file replaced the live one, or the process started from another directory | Keep one identity file at a persistent absolute path; it heals on the next reconnect |
| Dispatch fails now and then | The app host's clock is wrong | Run NTP on the host |
| `runtime_dispatch_trust_invalid` | The Hub's identity was re-keyed while the app was offline | Re-pair the app |
| `context.actor` is undefined on Relay | The app host cannot reach the Hub's key endpoint (`/.well-known/mcp-apps/jwks.json`) | Fix the route; the tool must keep refusing meanwhile |
| `context.actor` is undefined in a managed Runtime | The manifest lacks `capabilities.verifiedActor: true` | Declare it and publish a new version |
| Re-pairing a live app is refused | The app is live | Use Refresh and Approve update for manifest changes; uninstall first only to pair afresh |

## UI

| Symptom | Cause | Fix |
|---|---|---|
| The workspace shows a blank app in the dev loop | The browser cannot reach the Vite origin | Use a browser on the machine that runs `npm run dev`, forward port 5173, or set `PRIVOS_DEV_UI_ORIGIN` to the address the browser uses |
| A UI edit does not appear | The page loads the built UI, not the live one | Run `npm run dev`, not `npm start` |
| A host call fails with 403 | The scope is not declared, not granted, or used in a context the catalog does not allow | Declare it in `privos-app.json` with a valid context ([permission-catalog.md](permission-catalog.md)); an admin approves the update |
| `useFiles` always fails | It calls a host tool the Hub does not have | `usePrivosTool('privos.files.getByChannel', { channelId })` with `files:read` |
| Optional data missing | The optional scope was not granted | Expected; the UI must show its degraded state |
| The UI needs a token | It must not have one | Move the work into a server tool that uses `context.actor` |

## Manifest and tests

| Symptom | Cause | Fix |
|---|---|---|
| Lint passes, the marketplace refuses the manifest | The SDK lint is weaker than the marketplace check | Follow [manifest-and-scopes.md](manifest-and-scopes.md); run `publish --dry-run` |
| A scope is refused as unknown or in the wrong context | It is not in the catalog for that context or execution context | Check [permission-catalog.md](permission-catalog.md) |
| `ui://` URI refused | The host part is not the manifest `name` | Make them equal |
| Preflight exits 3 | A check was skipped (for example no docker, or no pairing) | Report each skipped check as skipped; do not call it passed |
| Preflight exits 2 | A check failed | Fix the named check and run it again |

## Packaging and publishing

| Code or symptom | Cause | Fix |
|---|---|---|
| `DIRTY_TREE` | Uncommitted or untracked files | Commit the intended files (never `--allow-dirty` unless the user asks) |
| `NOT_GIT_REPOSITORY` | The app is inside another repository, or has no commits | Make the app its own repository root and commit |
| `CREDENTIAL_FILE_FOUND`, `DENIED_PATH_IN_ARCHIVE` | An env file, key, identity file or `node_modules` is tracked | Untrack it and keep it in `.gitignore` |
| Upload `400 denied_path` for `.env.example` | The Portal refuses every `.env*` path, including `.env.example` | Add `/.env.example export-ignore` to `.gitattributes` (the archive is `git archive HEAD`) |
| `manifest_invalid`: `PRIVOS_ environment names are reserved` | An `env` key starts with `PRIVOS_` | Rename it (for example `APP_…`); only `PRIVOS_AGENT_BOT_CREDENTIAL` and `PRIVOS_AGENT_BOT_USER_ID` may be declared |
| `MISSING_REQUIRED_ENTRY` | `privos-app.json` or (server apps) `Dockerfile` is not at the root | Track both at the root |
| `MANIFEST_IDENTITY_MISMATCH` | `name` or `version` differ between the two files | Make them equal |
| `VERSION_SEMVER_EXISTS` | The version is already published | Bump both versions |
| `LISTING_UNRESOLVED` | The slug derived from the app id differs from the listing's | Pass `--listing <slug>`, or fix the id or the listing |
| `LISTING_NOT_BOUND` | A publisher token was used before the first interactive publish | Publish once with browser approval |
| `LISTING_CONTENT_INCOMPLETE` | The listing lacks content a first version needs | Complete it in Creator Studio, publish again |
| An INSTANT archive is refused on a new listing | The marketplace team has not set the INSTANT mode on it | Ask them, then publish again |
| `PUBLISHER_NOT_ENABLED` (exit 2) | The creator is not enabled | Do not retry; run the app on Relay |
| `AUTHORIZATION_EXPIRED` | Nobody approved within 15 minutes | Run it again and approve promptly |
| `PREFLIGHT_FAILED` after submit | The automated scan rejected the archive | Fix the findings, bump the version, publish again |
| Marketplace install fails with `mcp_app_id_conflict` | The same app id is live from Relay in that workspace | Uninstall the Relay copy there first |

## After approval (build node)

The build job runs once, when the version is approved, and is not retried: a version that fails here
is finished. Fix the cause and publish a new version.

| Code or symptom | Cause | Fix |
|---|---|---|
| `SCAN_FAILED` | A HIGH or CRITICAL advisory in a production dependency | `npm update <pkg>` or `overrides`, commit `package-lock.json`; preflight check `npm-audit` |
| `IMAGE_SCAN_FAILED` | A HIGH or CRITICAL advisory in an OS package of the image | `RUN apk --no-cache upgrade` in the runtime stage of the `Dockerfile` |
| `PACKAGING_FAILED runtime_manifest_unavailable` | The image, run with no env on a read-only root filesystem, did not serve `/.well-known/mcp/manifest.json` within 30 s | Start the server even without an identity (see [existing-app-to-marketplace.md](existing-app-to-marketplace.md#the-image-must-start-with-nothing)); preflight check `docker-image` |
| `PACKAGING_FAILED` stage `ui-build`, `exceeds the 2097152 byte per-asset limit` | The UI is built as one large chunk | Split build, no `inlineDynamicImports` / `codeSplitting: false` ([existing-app-to-marketplace.md](existing-app-to-marketplace.md#split-ui-build)) |
| `PACKAGING_FAILED` stage `ui-build`, `cannot read …/index.html` | `ui.distDir` is missing or wrong, or the shell is not named `index.html` | Set `ui.distDir` to the build output and emit `index.html` there |

Sources: [install and operate your own MCP app](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/install-and-operate-your-own-mcp-app.md),
[publishing CLI](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/publishing-cli.md),
the `privos-app-publish` error reference in `@privos_ai/app-server`, and the scaffold's `scripts/pair.ts`.
