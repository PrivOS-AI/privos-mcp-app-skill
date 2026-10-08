# An existing app to the marketplace

For an app that was **not** created with `create-privos-mcp-app` (an older Relay app, a hand-written
server) and now has to pass the marketplace. A scaffolded app already has most of this; run
`scripts/preflight.mjs` either way. Every point below cost a real app at least one failed version.

## Before anything

- Work on the branch the team uses for the platform version of the app, and pull first: preflight's
  `upstream` check fails a checkout that is behind. Packaging an old checkout ships old code.
- Each submission needs a higher version in **both** `package.json` and `privos-app.json`. A version that
  failed after approval cannot be retried.

## Scripts preflight runs

A scaffolded app has these in `package.json`; add the ones an older app lacks: `test`, `typecheck`,
`build` (writes the UI to `ui.distDir`), `start`, `manifest:lint:publish`
(`privos-app lint --publish privos-app.json`) and `publish:marketplace` (`privos-app publish`).

## SDK

Use `@privos_ai/app-server` **0.12** or later and `@privos_ai/app-react` **0.8** or later. `serveApp` and
`RuntimeModeError` arrived by 0.8, `serveBuiltUi` (the split UI the marketplace requires) in 0.10, and the
`privos-app bundle-ui` CLI the build node runs in 0.12; an app on 0.6 or older has none of them.
`startHttpIngress` still exists in 0.12: bump the version first, then move to `serveApp`.

`express` is a peer dependency the app installs itself; upgrading the SDK does not update it. Fix its
advisories (for example `proxy-addr`) with `npm update` and commit the lockfile.

## The image must start with nothing

The build node runs the image with **no environment variables** on a **read-only root filesystem**
(`--read-only --cap-drop ALL --tmpfs /tmp`) and waits 30 s for `/.well-known/mcp/manifest.json`.

- `src/server.ts` catches `RuntimeModeError` with code `PRODUCTION_WITHOUT_IDENTITY` and serves a
  manifest-only surface (`/.well-known/mcp/manifest.json`, `/health` 200, `/ready` 503) instead of exiting.
- An entrypoint that pairs must not run when there is nothing to pair. An older pairing entrypoint ran
  `chmod` on the identity directory (refused on a read-only filesystem) and then exited without a
  `PAIRING_URL`, so the server never started. Guard it right after the identity path is set:

  ```sh
  if [ -z "${PAIRING_URL:-}" ] && [ ! -f "$identity_file" ]; then
    exec node_modules/.bin/tsx src/server.ts
  fi
  ```

  An image without a pairing entrypoint can simply use `CMD ["node_modules/.bin/tsx", "src/server.ts"]`.
- At startup write only under `/tmp`. Anything that must persist needs `stateless: false` and exactly one
  `data` volume.

## Split UI build

The marketplace serves the UI from a signed bundle: at most **2 MB per file, 256 files, 64 MB in total**.
A UI forced into one chunk does not fit once it grows.

```ts
// vite.config.ts
base: './',
build: { outDir: '../../dist/ui', manifest: true, assetsInlineLimit: 0 },
// not: rolldownOptions.output.inlineDynamicImports: true, nor codeSplitting: false
```

- `ui.distDir` in `privos-app.json` names that output directory; the shell there must be `index.html`.
- `npm run build` must write the UI to `ui.distDir`: the build node runs exactly that command.
- Serve it with `serveBuiltUi` and pass a provider with `readAsset`, `readAssetsManifest` and
  `assetUriPrefix: 'ui://<name>/assets/'` to `serveApp` ([ui.md](ui.md)).
- The `ui://` host must equal the manifest `name`; preflight's `manifest-runtime` check enforces it.
- Do not commit the built UI.
- Split assets also work for a Relay app: the Hub fetches each asset live over `resources/read`.

## Dockerfile and archive

- Multi-stage on `node:22-alpine`, `npm ci` from the committed lockfile, `USER node`, and
  `RUN apk --no-cache upgrade` in the runtime stage (the image scan reads OS packages, not the lockfile).
- The uploaded archive is `git archive HEAD`, so `.gitattributes` decides what ships:

  ```gitattributes
  /.env.example export-ignore
  /.claude export-ignore
  /.agents export-ignore
  /AGENTS.md export-ignore
  /CLAUDE.md export-ignore
  ```

## Manifest points older apps miss

- No `env` key starting with `PRIVOS_` except the two agent-bot keys; no `PORT`, `HOME` or `PATH`.
- A permission scope must be in [permission-catalog.md](permission-catalog.md); remove a legacy `scopes`
  array from `package.json`.
- `dataPolicy.externalProcessing: true` needs `externalDestinations`.

Reference implementation: the [demo server app](https://github.com/PrivOS-AI/privos-mcp-app-demo).
