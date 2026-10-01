# UI

The UI is a React app under `src/ui/` built on `@privos_ai/app-react`. It runs in a sandboxed
frame inside the workspace, and every call it makes goes through the host.

## Shape

```tsx
import { PrivosAppProvider, usePrivosCapability, usePrivosContext } from '@privos_ai/app-react';

function Dashboard() {
  const ctx = usePrivosContext();
  const lists = usePrivosCapability('lists:read');
  // read optional data only when lists.granted; show a degraded state otherwise
}

export default function App() {
  return <PrivosAppProvider><Dashboard /></PrivosAppProvider>;
}
```

- `usePrivosCapability(scope)` returns `{ resolved, granted, scope }`. It is a presentation
  helper: wait for `resolved`, read optional data only when `granted`, and show the
  `degradedBehavior` you declared otherwise. The Hub still authorizes every call.
- `usePrivosContext()` returns display context (`userId`, `username`, `roomId`, `roomName`,
  `theme`, `userRoles`, ...). It carries no token.
- A UI that calls your own server tools does so through the host bridge
  (`usePrivosApp().callServerTool`), never by sending a user id as proof of who is calling.

## Hooks and the scopes they need

Every host tool a UI calls needs its scope declared in `privos-app.json`, or the call is
refused. The Hub maps a `privos.X` tool name to its `mcpapp.X` tool. The full mapping is in
`host-tools.json`; the scope values are in [permission-catalog.md](permission-catalog.md).

| UI call | Host tool | Scope |
|---|---|---|
| `usePrivosContext()` | `mcpapp.context.get` | none |
| `useLists(roomId)` | `privos.lists.getAll` | `lists:read` |
| `useRoom(roomId)` | `privos.rooms.get` | `rooms:read` |
| `useFiles(roomId)` | `privos.files.getAll`, which **does not exist** on the Hub | do not use it |
| `usePrivosTool('privos.files.getByChannel', { channelId })` | `mcpapp.files.getByChannel` | `files:read` |
| `usePrivosTool('privos.lists.getItems', ...)`, other list reads | `mcpapp.lists.*` reads | `lists:read` |
| list writes (`createItem`, `updateItem`, ...) | `mcpapp.lists.*` writes | `lists:write` |
| filtered item queries | `mcpapp.lists.queryItems` | `lists:query` |
| `mcpapp.db.*` reads / writes | app database | `db:read` / `db:write` |
| `mcpapp.db` schema calls | app database schema | `db:schema:read` / `db:schema:write` |
| `mcpapp.messages.getRecent` / `send` | messages | `messages:read` / `messages:send` |
| `mcpapp.users.get`, `getCurrent`, `getByIds` | users | `users:read` |
| `mcpapp.notifications.create` | notifications | `notifications:write` |
| `app.uploadFile(...)` | file upload | `files:write` |
| `app.rest({ path })` | a hub REST path | the scope that covers the path, else HTTP 403 |
| `app.storage.get/set/remove` | host `localStorage`, per app | none |

`useFiles` in `@privos_ai/app-react` 0.8.0 calls a tool the Hub does not have, so it always
fails. Use `usePrivosTool('privos.files.getByChannel', { channelId: roomId })` and declare
`files:read`. `app.rest({ method: 'GET', path: 'file-management.files.channel/' + roomId })` is
the REST equivalent.

`usePrivosTool(name, args)` auto-fetches and skips the fetch while any argument is empty.
Use it for reads. Do mutations in event handlers with `usePrivosApp().callServerTool(...)`.

## The frame

The app document runs in an opaque origin:

- Its own `localStorage` throws or is wiped. Use `app.storage` for device-local preferences
  and the server (or `mcpapp.db`) for anything that must follow the user.
- The microphone and wake lock go through the host (`app.startMicrophone`,
  `app.requestWakeLock`), and the tool must declare `microphone` or `screen-wake-lock` in its
  `ui.permissions`. Camera is not brokered.
- Files a server returns as bytes arrive as a base64 envelope through `app.rest`; pass
  `responseType: 'blob'` to have the host decode it.
- A tool's `ui.csp` widens the frame's content security policy for the origins you list;
  `ui.hideAiChat: true` on the room-tab tool hides the hub's AI chat launcher.

## Nothing secret belongs in UI code

The built UI is served to every user who opens the app, and the dev UI to anyone who can
reach the dev server. So:

- No API keys, tokens, passwords or private URLs in `src/ui/`, in a `VITE_*` variable or in
  the manifest. `VITE_*` values are compiled into the bundle.
- No user token: the hook does not expose one, and the raw host tool `mcpapp.context.get`
  returns one only to direct callers. Do not build on it.
- Anything that needs a secret is a server tool. The UI asks, the server acts with its
  own environment.
- A static shell must not contain per-user data (template placeholders or JWT-shaped tokens);
  `npm run manifest:lint:publish` flags that.

## Dev loop

`npm run dev` serves the UI live from a Vite server on port 5173; the workspace page loads
its scripts from that origin, and edits appear without a rebuild or a reload. The browser that
shows the workspace must run on the machine that runs Vite, or reach it through a forwarded
port. For a forwarded or tunnelled address set `PRIVOS_DEV_UI_ORIGIN` to an http(s) origin
without a path, for example `PRIVOS_DEV_UI_ORIGIN=https://dev.example.com npm run dev`. For an INSTANT
app's workspace preview see [app-kinds.md](app-kinds.md#instant-details).

## Build

`npm run build` writes the UI to `dist/` and (server apps) the server to `dist-server/`.
`serveBuiltUi` validates the whole build at boot: hashed assets and no source maps, so a broken
build stops the process instead of showing a blank frame. The signed bundle has budgets of
2 MB per file, 256 files and 64 MB in total. `ui.distDir` in the manifest names the output
directory when it is not `dist`.

## Theme

`PrivosAppProvider` writes the workspace's `--base-*` CSS variables onto the document. Use
them with fallbacks so the app still looks right before the first context arrives:

```css
body { background: var(--base-bg-main, #fff); color: var(--base-text-primary, #111); }
```

## Tests

Test UI states that depend on a scope: granted, not granted, unresolved. Keep the scaffold's
manifest tests; they fail when a `ui://` URI points at another app id.

Sources: [React SDK reference](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/react-sdk-reference.md),
[theme inheritance](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/theme-inheritance.md),
[the signed UI bundle](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/ui-bundle.md)
and the `@privos_ai/app-react` 0.8.0 package.
