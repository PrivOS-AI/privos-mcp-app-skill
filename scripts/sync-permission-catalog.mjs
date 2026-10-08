#!/usr/bin/env node
// Regenerates skills/privos-mcp-app/references/permission-catalog.json and the scope table in
// permission-catalog.md from the Hub's permission catalog — the file the Portal's marketplace
// catalog is a byte-identical copy of.
//
//   node --experimental-transform-types scripts/sync-permission-catalog.mjs <privos-hub>/apps/meteor/server/services/mcp-permission-catalog.ts
//
// The Hub has added scopes without bumping MCP_PERMISSION_CATALOG_VERSION, so comparing versions
// does not detect a stale copy: regenerate from the file, never edit the JSON or the table by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = process.argv[2];
if (!source) {
  console.error('usage: node --experimental-transform-types scripts/sync-permission-catalog.mjs <path to mcp-permission-catalog.ts>');
  process.exit(1);
}
const hub = await import(pathToFileURL(resolve(source)).href);
const version = hub.MCP_PERMISSION_CATALOG_VERSION;
const catalog = hub.MCP_PERMISSION_CATALOG;
if (!version || !catalog) throw new Error(`${source} does not export MCP_PERMISSION_CATALOG_VERSION and MCP_PERMISSION_CATALOG`);

const scopes = Object.entries(catalog)
  .map(([scope, e]) => ({ scope, label: e.label, contexts: [...e.contexts], executionContexts: [...e.executionContexts] }))
  .sort((a, b) => a.scope.localeCompare(b.scope));

const refs = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'privos-mcp-app', 'references');
writeFileSync(join(refs, 'permission-catalog.json'), `${JSON.stringify({ catalogVersion: version, scopes }, null, 2)}\n`);

const mdPath = join(refs, 'permission-catalog.md');
const md = readFileSync(mdPath, 'utf8');
const header = '| Scope | Label | Contexts | Execution contexts |\n|---|---|---|---|\n';
const rows = scopes.map((s) => `| \`${s.scope}\` | ${s.label} | ${s.contexts.join(', ')} | ${s.executionContexts.join(', ')} |`).join('\n');
const start = md.indexOf(header);
const end = md.indexOf('\n\n', start + header.length);
if (start < 0 || end < 0) throw new Error('scope table not found in permission-catalog.md');
writeFileSync(mdPath, md.slice(0, start) + header + rows + md.slice(end).replace(/catalog at version `[^`]+`/, `catalog at version \`${version}\``));
console.log(`permission catalog ${version}: ${scopes.length} scopes`);
