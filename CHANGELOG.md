# Changelog

## 0.2.0 — 2026-10-08

- Preflight mirrors more of what the marketplace refuses: `env` keys (`PRIVOS_*`, `PORT`, `HOME`,
  `PATH`), port, resources, runtime size and volumes, the `ui://` host, the archive `git archive HEAD`
  produces (denied paths such as `.env.example`, root entries, size), a branch behind its upstream, and
  HIGH or CRITICAL advisories in production dependencies (`npm audit`).
- Permission catalog regenerated from the Hub catalog: 51 scopes (adds `rooms:roles:read` and the
  `firm-knowledge:*` scopes). `scripts/sync-permission-catalog.mjs` regenerates it; the Hub adds scopes
  without bumping the catalog version, so the version alone does not reveal a stale copy.
- Host tools: the four `privos.app.*LocalData` tools (no scope).
- New reference `existing-app-to-marketplace.md`; troubleshooting covers failures after approval
  (`SCAN_FAILED`, `IMAGE_SCAN_FAILED`, `runtime_manifest_unavailable`, `ui-build`).
- CI runs the preflight tests.

## 0.1.0 — 2026-10-01

- Repository layout, plugin manifests and checks.
- The `privos-mcp-app` skill: a twelve-step workflow and eight references (app kinds,
  manifest and scopes, the permission catalog, server and identity, UI, Relay for development
  and production, marketplace submission, troubleshooting).
- Preflight script, permission catalog and UI hook tables, read-only eval cases and end-to-end
  briefs.
