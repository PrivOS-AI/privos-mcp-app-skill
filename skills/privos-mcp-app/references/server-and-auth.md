# Server, identity and secrets

For server apps (`--template default`). An INSTANT app has no server; see
[ui.md](ui.md) for what it must keep out of its code.

## Entry points

| File | Role |
|---|---|
| `src/server.ts` | Starts `serveApp`; picks managed, paired (Relay) or development mode from the machine |
| `src/tools.ts` | `tools/list` (the manifest's tool list) and `tools/call` (dispatch by name) |
| `src/manifest.ts` | Reads `privos-app.json` on every call |
| `src/dev-ui.ts` | Live Vite UI for `npm run dev` only |
| `scripts/pair.ts` | `npm run pair` |
| `tests/` | Manifest invariants and tool tests |

A tool exists in exactly one place in the manifest and one place in `toolHandlers`. Add both,
then a test. The scaffold's test checks that every manifest tool has a handler.

## Handler contract

A handler is `(args, context) => result`. The result is
`{ content: [{ type: 'text', text }], isError? }`.

## Identity

The caller and the room come only from the verified `context`:

- `context.actor`: the user the Hub signed for (`userId`, `username`, `provenance`).
- `context.roomId`: the room the dispatch was authorized for.

Rules:

1. Never read a user id or room id from the arguments, request metadata or a header. They
   prove nothing. A tool that needs a room takes it from `context.roomId`.
2. Fail closed. When `context.actor` is missing, answer with an error result and do not fall
   back to an argument or a default user. Give the error no claimed identity.
3. Declare `"capabilities": { "verifiedActor": true }` in `privos-app.json`. In a managed
   Runtime, dispatch carries the acting user only with that declaration; without it
   `context.actor` is undefined. Only the value `true` counts. The flag asks for the identity
   to display or attribute with; it grants nothing.
4. A paired (Relay) app gets the caller from a signed user token that the SDK verifies against
   the Hub's published keys. The app host must reach the Hub's key endpoint. If it cannot, the
   actor is reported as absent rather than assumed.
5. The UI never receives a user token: `usePrivosContext()` exposes display fields only, and
   calls from the UI are mediated by the Hub. Do not build on the raw host tool
   `mcpapp.context.get`, which returns a token to direct callers, and never ask the browser to
   forward Hub credentials to the app.
6. To verify a token inside an app-owned HTTP route, use the SDK (`buildHubUserTokenAuthOptions`
   and `verifyUserToken`), which pins the algorithm and checks expiry and audience. Fail closed
   on a failed verification. `assertActorAvailable` refuses a call without an actor.

### Negative tests to write for every tool

- **Wrong room**: call the tool with a verified context for room A and an argument that names
  room B. The result must describe room A, or the tool must refuse.
- **Missing actor**: call the tool with a context that has no actor and arguments that claim a
  user and a room. The result must be an error that does not contain the claimed values.
- **Unknown tool and unknown method**: JSON-RPC errors `-32602` and `-32601`.

The scaffold's `tests/tools.spec.ts` shows all three for its `whoami` tool; copy its shape.

## Secrets and trust

- The pairing identity file (`privos-standalone-identity.json` and its `.pending.json` half)
  holds relay credentials and dispatch trust. It stays out of git, out of images and out of
  environment files. The scaffold's `.gitignore` and `.dockerignore` exclude it.
- Also keep out of git: `.env*` (only `.env.example` may be committed), `.npmrc`, `*.pem`,
  `*.key`, `*.crt`, `*.p12`, `*.pfx`, and any other credential file. The marketplace packager
  refuses an archive with credential files or `.env*`, so a clean repository matters twice.
- Server-side secrets an operator must supply go through the app's environment, not through
  the UI and not through the manifest.
- UI code and every `VITE_*` value are public; see [ui.md](ui.md).
- A publisher token (`pvp_...`) and a pairing URL are secrets: never ask for them in chat,
  never put them in a file, a command argument or a log.

## `/.well-known/mcp/register`

Do not implement it. The Hub's best-effort push to that path is sent when an admin connects a
direct-connect app, and it carries no signature (its only header is `Content-Type`), so there
is no proof of origin: an endpoint that stores credentials from it would store them from anyone
who can reach the app. The Hub treats a 404 as "skipped" and the admin then enters the
credentials by hand, which is the intended outcome. A paired (Relay) app never receives the
push; pairing delivers trust over an authenticated connection.

## Starting the app

- `serveApp` reads `PORT` and falls back to the manifest `port`. A host that exports `PORT`
  changes the port; unset it in development.
- `NODE_ENV=production` without a workload socket or an identity file makes the app serve the
  manifest and `/health` only and keep `/ready` at 503. That is the bare start the marketplace
  build node uses. In development `npm run dev` forces `NODE_ENV=development`.
- Health endpoints: `/health` is liveness, `/ready` reports readiness with a reason, see
  [relay-dev-and-production.md](relay-dev-and-production.md#ready-and-its-reasons).

## Licensing

Declare tiers in the manifest (`license.tiers`, fields in
[manifest-and-scopes.md](manifest-and-scopes.md#licence-tiers)). In the app:

- Resolve the active tier in one place and gate each paid feature and limit through a guard.
- Fail closed to the free tier: no licence, an unreadable one or a lapsed one gives the free
  tier's features and limits, and never deletes or changes data.
- Tell the user plainly that **how a licence reaches a running app at run time is not
  documented**. The public demo reads a JSON value from an environment variable and labels it a
  compatibility surface for a package that does not exist yet; do not present that as the
  platform's mechanism, and do not invent another.

## Test and run commands

| Command | Does |
|---|---|
| `npm test` | Vitest; tool and manifest tests |
| `npm run typecheck` | `tsc --noEmit` over UI, scripts and tests |
| `npm run build` | UI into `dist/`, server into `dist-server/` |
| `npm start` | The built app (paired: Relay; unpaired in production: manifest only) |

Sources: the scaffold's `src/` and `tests/`, the
[developer guide](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/developer-guide.md#declaring-the-verified-actor-capability),
[Tools: context](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/apis/tools-context.md#signed-user-identity),
the [credential push contract](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/apis/rest-credential-push.md)
and the [reference app](https://github.com/PrivOS-AI/privos-mcp-app-demo).
