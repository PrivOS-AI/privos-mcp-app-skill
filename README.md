# PrivOS MCP app skill

An agent skill that takes an idea to a PrivOS MCP app: it scaffolds the app,
connects it to your own PrivOS workspace over Relay while you build it, and
gets it ready for production on Relay or for the PrivOS Marketplace.

## Install

Install it for your user, not inside an app repository, so the skill stays out
of the apps you build.

### Claude Code plugin

```bash
claude plugin marketplace add PrivOS-AI/privos-mcp-app-skill
claude plugin install privos-mcp-app@privos
```

Invoke it by asking for a PrivOS app, or explicitly as
`/privos-mcp-app:privos-mcp-app`.

### skills.sh

```bash
npx skills add PrivOS-AI/privos-mcp-app-skill -g
```

## What it covers

The skill walks an agent through twelve steps, each of which names the command it runs or the
file it produces: intake, choosing the production target, scaffolding with
`create-privos-mcp-app`, connecting to your workspace over Relay, the manifest, server tools,
the UI, licensing, tests, a preflight check, production on Relay, and marketplace submission.

- Choosing between an INSTANT app (UI only) and a server app (tools plus UI).
- Developing in your own workspace over Relay: pair once with `npm run pair`, run the app with
  `npm run dev`, and see it in the workspace with the real identity and scopes. Relay is one
  path with one protocol for development and production; the workspace treats both the same.
- Production on Relay (self-hosted, server apps) with `npm start`, or through the PrivOS Marketplace for
  INSTANT and managed Runtime apps. Publishing works for enabled creators; anyone else gets
  `PUBLISHER_NOT_ENABLED` and nothing is uploaded, and the app still runs on Relay.
- The rules that trip up first apps: identity from the verified context only, every scope the
  UI uses declared, the stricter marketplace manifest rules, and secrets that stay out of git
  and out of UI code.

The skill links to the public
[PrivOS developer docs](https://github.com/PrivOS-AI/privos-dev-docs/tree/main/mcp-app-platform)
instead of repeating their API tables. `skills/privos-mcp-app/references/` holds the
eight reference files, the permission catalog and the UI hook to scope table.

The skill never asks for a pairing URL in the conversation: you run `npm run pair` in your own
terminal.

## Limits

A managed Runtime install of a scaffolded app has not been exercised end to end: the server
template runs on `serveApp`, as the public demo app does in managed Runtime, and it passes the
marketplace's local gates, but no scaffolded app has been submitted, built and installed by the
platform as part of testing this skill.

## Tested with

- `create-privos-mcp-app` 0.6.0, `@privos_ai/app-server` 0.12.3 and `@privos_ai/app-react` 0.8.0.
  Both templates, scaffolded from the npm registry, pass the skill's preflight script and a local
  mirror of the marketplace gates. The server template's development and production loop over
  Relay, and the INSTANT preview, were checked on a real workspace.
- Claude Code 2.1.284: the read-only eval suite in `evals/` passes, with the skill firing for
  every PrivOS request and staying silent for a generic MCP server request.
- The end-to-end briefs in `e2e/` have not been run yet.

## Maintaining

Every commit is authored and committed as `PrivOS <support@privos.ai>`, and every push is
scanned for secrets and internal identifiers first. For a release: bump `version` in
`.claude-plugin/plugin.json` (plugin users keep their cached copy until it changes), add a
`CHANGELOG.md` entry, run `scripts/check-skill.sh --require-claude --online`, then tag `v<version>`
with an annotated tag and publish a GitHub release with the changelog entry.

## License

MIT
