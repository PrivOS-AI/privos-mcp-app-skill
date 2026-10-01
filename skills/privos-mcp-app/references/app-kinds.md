# App kinds

A PrivOS MCP app is one of two shapes. Development is over Relay for both; the shape
decides what can run in production and where.

| | Server app (`--template default`) | INSTANT app (`--template instant`) |
|---|---|---|
| What you write | Server tools (`src/tools.ts`) and a React UI (`src/ui/`) | A React UI (`src/ui/`) only |
| `executionMode` in `privos-app.json` | absent (runtime) | `"INSTANT"` |
| Server, container, port | Yes: `serveApp`, a `Dockerfile`, a `port` | None |
| Data | Whatever the server keeps, or host APIs | PrivOS Lists, reached from the browser through `@privos_ai/app-react` |
| `dataPolicy` and `stateless` | Required | Not declared (the lint rejects `stateless`) |
| Runs in production on | Relay (self-hosted) or managed Runtime | Marketplace only (a Relay preview is for development) |
| Marketplace | Yes | Yes, after the listing is set to INSTANT mode |

## Choosing

Pick **INSTANT** when the app is a UI over records, statuses, checklists or boards that
PrivOS Lists can model, and needs no server-side integration, background job or
third-party call. An INSTANT app has no path to add a backend later without becoming a
different kind of app.

Pick a **server app** when the brief needs any of: a tool the agent or other apps can
call, a server-side integration, a background job, secrets the browser must not hold, or
data of its own.

When unsure and the brief mentions a tool, an agent action or an external API, choose a
server app.

## One server app, two runtimes

The server template uses `serveApp`, which picks its transport from the machine:

| Mode | When | Trust |
|---|---|---|
| Managed | The platform mounts a workload socket (marketplace install) | Signed dispatch, verified actor when `capabilities.verifiedActor` is true |
| Standalone (Relay) | The app was paired and the identity file is next to it | Signed dispatch, verified caller |
| Development | Neither, and `NODE_ENV` is not production | Unsigned, loopback only, no verified caller |

The same code and the same `privos-app.json` serve Relay and managed Runtime. `npm run dev`
and `npm start` are the same app; the only difference is a live Vite UI versus the built UI.
Development mode (no pairing) is for trying tools on one machine. It is not a workspace test:
tools that need a caller refuse there.

A container started bare (no socket, no identity file, as the marketplace build node runs it)
serves the manifest and `/health` only, and keeps `/ready` at 503. The template already does
this; keep that behavior when editing `src/server.ts`.

## INSTANT details

- `ui.entryPoints.roomTab` is required; `sidebar` and `standalone` are optional. Each has a
  `title` and a `resourceUri` of the form `ui://<app id>/<file>.html`, where the host part is
  the manifest `name`.
- Fields an INSTANT manifest must never declare: `tools`, `serverUrl`,
  `runtimeTrustProvisioningUrl`, `port`, `resources`, `volumes`, `stateless`.
  `ui.shellMode: "live"` is refused.
- An optional `agent` section gives the room's AI chat a persona: `purpose` (required),
  `personality`, `instructions`, `knowledge`, `hubTools`.
- The manifest has no tools. A workspace Relay tab takes its UI from a tool that declares a
  `ui`, so the INSTANT preview (`npm run pair`, then `npm run dev`) runs `scripts/dev-relay.ts`,
  a dev-only server that pairs a relay manifest: `privos-app.json` plus one UI tool per
  `ui.entryPoints` entry, built in memory. `privos-app.json` itself stays tool-free and is
  what the marketplace sees. The preview serves one UI page, so every entry point must use
  the same `ui://` URI. It listens on `PORT`, else 3001.
- There is no `npm start` for an INSTANT app: the dev server is not part of what is published,
  and production is the marketplace.
- Data is modelled as Lists created on first use from the browser (`lists:write`) and read
  back with `lists:read` or `lists:query`.
- The marketplace runs `npm ci && npm run build` and a UI bundle step. The Relay preview above
  is the way to see the app in a workspace before it is published.

## Managed Runtime details

- The `Dockerfile` at the repo root builds the image; the scaffold's runs as a non-root user
  on `node:22-alpine`, keeps no package manager in the runtime stage and has a health check
  on `/health`. Keep `EXPOSE`, `PORT` and the manifest `port` in step.
- `resources` (`memoryMb`, `cpus`, `tmpSizeMb`) is what the platform allocates. An optional
  `runtime` block (`minimumSize`, `recommendedSize`) pins them to a billing size, and then
  `resources` must equal that size. Sizes: XS 256 MB / 0.25 CPU, S 512 MB / 0.5, M 1024 MB / 1,
  L 2048 MB / 2, XL 4096 MB / 4.
- `stateless: true` means no data volume. A stateful app sets `stateless: false` and declares
  exactly one volume named `data` with a `mountPath`.
- Keep the `Dockerfile` step that upgrades the base image's packages, so the image does not ship known
  vulnerabilities.

Sources: [INSTANT apps](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/instant-apps.md),
[developer guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/developer-guide.md),
[runtime modes](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/runtime-modes.md),
and the scaffold's `src/server.ts` and `Dockerfile`.
