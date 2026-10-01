# Marketplace submission (creator side)

The marketplace takes INSTANT apps and managed Runtime apps (the server template). A Relay app
that stays self-hosted needs none of this. Publish only when the user asks. The publishing
itself is done by the `privos-app-publish` skill that the scaffold places in the app under
`.claude/skills/`; this file covers what the creator has to have in place first.

## Who can publish

Publishing works for creators the marketplace has enabled. For anyone else the Portal refuses
the upload with `PUBLISHER_NOT_ENABLED` before it stores anything: the CLI prints the message
and exits 2, no version is created and the publish approval is not used up. Do not retry. The
app can still run in the user's own workspace on Relay (see
[relay-dev-and-production.md](relay-dev-and-production.md)). Say this before the first attempt
so the user is not surprised by it.

## Before the first publish (Creator Studio)

Done once per app in Creator Studio at `client.privos.io`. The CLI publishes the code identity
only; the listing is web-side.

1. **Enrol as a creator.** Sign in with the account that will own the listing, open Creator
   Studio, enter a creator display name and enrol. The account that creates a listing owns it,
   and ownership cannot be moved from the UI later.
2. **Create a draft listing** of type `MCP_APP` with a name, tagline, description, pricing and
   a category. Its **slug derives from the app id** (`name` in `privos-app.json`): lower-cased,
   every run of characters other than `a-z` and `0-9` becomes one hyphen, at most 63
   characters. The id `ai.acme.okr` needs the slug `ai-acme-okr`. The Portal refuses to bind a
   listing whose slug differs, so choose the app id before creating the listing.
3. **INSTANT apps: the INSTANT execution mode.** A new listing defaults to the managed-runtime
   mode and refuses an INSTANT archive until the marketplace team has set the INSTANT mode on
   it. Creator Studio has no editor for it. Ask the marketplace team before the first upload.
4. **Complete the listing content a first version needs.** A first version is refused with
   `409 LISTING_CONTENT_INCOMPLETE` until the listing has:
   - a primary category, at least 3 features and at least 2 use cases;
   - a support email or URL, a documentation URL, a privacy policy URL and a terms URL;
   - an icon, and at least 2 screenshots, each with alt text and a caption.

   Uploaded images are reviewed by the marketplace team. The error lists what is missing and
   no version number is used up.

## Local gates before publishing

```bash
npm run manifest:lint:publish
node <skill dir>/scripts/preflight.mjs
npm run publish:marketplace -- --dry-run
```

The dry run packages the repository with `git archive HEAD` and prints the revision and the
archive hash; nothing is uploaded. It refuses a dirty tree, so commit first. Packaging rules:

- `privos-app.json` (and `Dockerfile` for a server app; an INSTANT app needs none) at the
  repository root.
- `package-lock.json` committed; the build runs `npm ci`.
- No `.env*`, `node_modules`, `.git`, credential files or identity files in the archive; the
  scaffold's `.gitattributes` also keeps agent folders and instruction files out.
- Limits: 20,000 entries, 50 MB per file, 200 MB in total.
- `name` and `version` agree between `privos-app.json` and `package.json`
  (`MANIFEST_IDENTITY_MISMATCH` otherwise).

## Publish

```bash
npm run publish:marketplace
```

The command packages, lints, then prints an approval URL and a code. The **listing owner** opens
the URL in their own browser on `client.privos.io`, signs in and approves; the agent cannot
click it and must not try. The command then uploads, creates the version and submits it.
Approval is valid for 15 minutes. Never pass `--portal`; the default is the only public
Portal.

For CI there is a publisher token (`pvp_...`) created in Creator Studio with a step-up check.
It works only for a listing whose first version was already approved in the browser. The
token goes in the environment of the CI job, never in chat, a file or a command argument.

## Review

After submit the version moves through `PREFLIGHT_PENDING`, scan, AI review, human approval and
the platform build, and then it is published. The CLI has no status command: follow progress in
Creator Studio. `PREFLIGHT_FAILED` means the automated scan rejected the archive (the CLI prints
the findings, exit 2): fix it, bump the version and publish again. `PREFLIGHT_BLOCKED_INFRA` is
an infrastructure state only and needs no local change. A UI is bundled and signed by the
build, and a version whose UI bundle fails does not reach published.

## Releasing an update

Later versions reuse the listing, its execution mode, its content and its approved media.

1. Bump `version` in **both** `privos-app.json` and `package.json`.
2. Commit.
3. Run the local gates and `npm run publish:marketplace` again.

Publishing a version number that already exists fails with `VERSION_SEMVER_EXISTS` (exit 2).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Submitted, or a benign non-blocking status |
| 2 | Blocked by policy: invalid manifest, dirty tree, denied path, semver reused, listing content incomplete, `PUBLISHER_NOT_ENABLED`, preflight failed, listing not bound or unresolved |
| 3 | Authorization denied, expired or consumed; publisher token invalid |
| 4 | Network or Portal error |
| 5 | Usage error, cancelled prompt, not a git repository |

## A workspace where the app ran on Relay

An app id is live once per workspace. Before the marketplace copy is installed in a workspace
where the same app ran over Relay, uninstall the Relay copy there. Otherwise the install fails
with `mcp_app_id_conflict`.

Sources: [publishing CLI](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/publishing-cli.md),
[INSTANT apps](https://github.com/PrivOS-AI/privos-dev-docs/blob/main/mcp-app-platform/instant-apps.md),
and the error reference of the `privos-app-publish` skill shipped in `@privos_ai/app-server`.
