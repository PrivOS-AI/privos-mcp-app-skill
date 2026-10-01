#!/usr/bin/env node
// Preflight for a PrivOS MCP app: a local mirror of what the Portal and the
// marketplace build node check, plus the app's own scripts.
//
//   node <skill dir>/scripts/preflight.mjs [app-dir]
//
// One line per check: PASS|FAIL|SKIPPED <check> <reason>.
// Exit 0: all passed. 2: a check failed. 3: nothing failed but a check was
// skipped. 1: usage error. A skipped check is never a pass.
//
// Zero dependencies, Node 22 or later. Manifest rules repeat the Portal's
// `marketplace-archive-manifest.ts`; the scope table is references/permission-catalog.json.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME_RULE = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const FEATURE_RULE = NAME_RULE;
const SCOPE_RULE = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SLUG_RULE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const EXECUTION_MODES = ['SELF_HOSTED_LOCAL', 'PRIVOS_MANAGED_RUNTIME', 'PUBLISHER_HOSTED', 'INSTANT'];

const COMMON_KEYS = [
  'kind', 'name', 'version', 'title', 'description', 'icon', 'author', 'homepage', 'repository', 'tools', 'port',
  'resources', 'runtime', 'volumes', 'stateless', 'license', 'executionMode', 'ui', 'agent', 'schemaVersion',
  'permissions', 'dataPolicy', 'availabilityTier',
];
const V3_KEYS = [
  'env', 'capabilities', 'agentBot', 'resourceManifestTemplate', 'minimumUpgradeFromVersion', 'publicAccess',
  'exposedPorts',
];
const TOOL_KEYS = ['name', 'title', 'description', 'inputSchema', 'ui'];
const TOOL_UI_KEYS = ['resourceUri', 'permissions', 'csp', 'hideAiChat'];
const PERMISSION_KEYS = [
  'scope', 'requirement', 'context', 'executionContext', 'feature', 'reason', 'recommended', 'degradedBehavior',
];
const APP_UI_KEYS = ['entryPoints', 'shellMode', 'distDir'];

// Commands run without the ops host's live service variables.
const STRIPPED_ENV = ['NODE_ENV', 'PORT', 'MONGODB_URL', 'BOARD_DB_DIALECT', 'DATA_DIR', 'API_ACCESS_KEY'];
const HARDENING = [
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '1g', '--cpus', '1',
  '--pids-limit', '256', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
];
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const oneLine = (text, max = 300) => String(text).replace(/\s+/g, ' ').trim().slice(0, max);

export function loadData() {
  const read = (file) => JSON.parse(readFileSync(join(HERE, '..', 'references', file), 'utf8'));
  return { catalog: read('permission-catalog.json'), hostTools: read('host-tools.json') };
}

const result = (status, check, reason) => ({ status, check, reason: oneLine(reason) });
const pass = (check, reason = 'ok') => result('PASS', check, reason);
const fail = (check, reason) => result('FAIL', check, reason);
const skip = (check, reason) => result('SKIPPED', check, reason);
const verdict = (check, problems, okReason) => (problems.length ? fail(check, problems.join('; ')) : pass(check, okReason));

/** The listing slug the Portal derives from the manifest name (canonicalListingSlug). */
export function listingSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function unknownKeys(value, allowed, where) {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => (key === 'runtimeTrustProvisioningUrl'
      ? `${where}runtimeTrustProvisioningUrl is not allowed in a published manifest`
      : `${where}unknown key "${key}"`));
}

/** Structural rules of the Portal manifest schema that an agent is likely to break. */
function manifestFieldProblems(m) {
  const p = [];
  if (m.schemaVersion !== 2 && m.schemaVersion !== 3) {
    p.push(`schemaVersion must be 3 (got ${JSON.stringify(m.schemaVersion)}; 1 is the legacy scopes-only format)`);
  }
  p.push(...unknownKeys(m, m.schemaVersion === 3 ? [...COMMON_KEYS, ...V3_KEYS] : COMMON_KEYS, 'manifest: '));
  if (m.kind !== 'mcp-app') p.push('kind must be "mcp-app"');
  if (typeof m.name !== 'string' || !NAME_RULE.test(m.name)) p.push(`name must match ${NAME_RULE}`);
  if (typeof m.version !== 'string' || !SEMVER.test(m.version)) p.push('version must be semver (1.2.3)');
  if (!isText(m.title, 2, 100)) p.push('title must be 2-100 characters');
  if (!isText(m.description, 10, 2000)) p.push('description must be 10-2000 characters');
  if (!isObject(m.author) || !isText(m.author.name, 1, 100)) p.push('author.name is required (1-100 characters)');
  if (m.executionMode !== undefined && !EXECUTION_MODES.includes(m.executionMode)) {
    p.push(`executionMode must be one of ${EXECUTION_MODES.join(', ')}`);
  }
  if (m.tools !== undefined && !Array.isArray(m.tools)) p.push('tools must be an array');
  const names = new Set();
  (Array.isArray(m.tools) ? m.tools : []).forEach((tool, i) => {
    const at = `tools[${i}]: `;
    if (!isObject(tool)) return p.push(`${at}must be an object`);
    p.push(...unknownKeys(tool, TOOL_KEYS, at));
    if (typeof tool.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tool.name)) p.push(`${at}invalid name`);
    else if (names.has(tool.name)) p.push(`${at}duplicate tool name ${tool.name}`);
    else names.add(tool.name);
    if (!isText(tool.title, 1, 160)) p.push(`${at}title is required (1-160 characters)`);
    if (!isText(tool.description, 1, 2000)) p.push(`${at}description is required (1-2000 characters)`);
    if (!isObject(tool.inputSchema)) p.push(`${at}inputSchema must be an object`);
    if (tool.ui !== undefined) {
      if (!isObject(tool.ui)) p.push(`${at}ui must be an object`);
      else {
        p.push(...unknownKeys(tool.ui, TOOL_UI_KEYS, `${at}ui: `));
        if (!isText(tool.ui.resourceUri, 1, 2048)) p.push(`${at}ui.resourceUri is required`);
      }
    }
  });
  if (m.ui !== undefined) {
    if (!isObject(m.ui)) p.push('ui must be an object');
    else {
      p.push(...unknownKeys(m.ui, APP_UI_KEYS, 'ui: '));
      if (m.executionMode === 'INSTANT' && m.ui.shellMode === 'live') p.push('ui.shellMode "live" is not allowed for INSTANT apps');
    }
  }
  return p;
}

/** reason, degradedBehavior, feature, uniqueness: the Portal is stricter than the SDK lint. */
function manifestPermissionProblems(m) {
  const p = [];
  if (!Array.isArray(m.permissions) || m.permissions.length < 1 || m.permissions.length > 50) {
    return ['permissions must list 1-50 entries'];
  }
  const scopes = new Set();
  const features = new Set();
  m.permissions.forEach((perm, i) => {
    const at = `permissions[${i}]${isObject(perm) && perm.scope ? ` (${perm.scope})` : ''}: `;
    if (!isObject(perm)) return p.push(`${at}must be an object`);
    p.push(...unknownKeys(perm, PERMISSION_KEYS, at));
    if (typeof perm.scope !== 'string' || !SCOPE_RULE.test(perm.scope)) p.push(`${at}invalid scope`);
    else if (scopes.has(perm.scope)) p.push(`${at}duplicate scope`);
    else scopes.add(perm.scope);
    if (!['required', 'optional'].includes(perm.requirement)) p.push(`${at}requirement must be required or optional`);
    if (!['workspace', 'room'].includes(perm.context)) p.push(`${at}context must be workspace or room`);
    if (!['user', 'background', 'both'].includes(perm.executionContext)) p.push(`${at}executionContext must be user, background or both`);
    if (typeof perm.feature !== 'string' || !FEATURE_RULE.test(perm.feature)) p.push(`${at}feature must match ${FEATURE_RULE}`);
    else if (features.has(perm.feature)) p.push(`${at}duplicate feature ${perm.feature}`);
    else features.add(perm.feature);
    if (!isText(perm.reason, 10, 1000)) p.push(`${at}reason must be 10-1000 characters`);
    if (perm.degradedBehavior !== undefined && !isText(perm.degradedBehavior, 10, 1000)) {
      p.push(`${at}degradedBehavior must be 10-1000 characters`);
    }
    if (perm.requirement === 'required' && perm.degradedBehavior) p.push(`${at}a required permission cannot declare degradedBehavior`);
    if (perm.requirement === 'optional' && !perm.degradedBehavior) p.push(`${at}an optional permission needs degradedBehavior`);
  });
  if (m.schemaVersion === 2 && new Set(m.permissions.map((x) => x?.context)).size > 1) {
    p.push('schemaVersion 2 allows one context (workspace or room) for all permissions');
  }
  return p;
}

/** dataPolicy and stateless are required for every non-INSTANT app. */
function manifestDataProblems(m) {
  const p = [];
  const instant = m.executionMode === 'INSTANT';
  const dp = m.dataPolicy;
  if (dp === undefined) {
    if (!instant) p.push('dataPolicy is required for every app except INSTANT');
  } else if (!isObject(dp)) p.push('dataPolicy must be an object');
  else {
    if (!isText(dp.version, 1, 100)) p.push('dataPolicy.version is required');
    if (!isText(dp.retention, 10, 2000)) p.push('dataPolicy.retention must be 10-2000 characters');
    if (typeof dp.externalProcessing !== 'boolean') p.push('dataPolicy.externalProcessing must be true or false');
    if (dp.externalProcessing === true && !(Array.isArray(dp.externalDestinations) && dp.externalDestinations.length)) {
      p.push('dataPolicy.externalDestinations is required when externalProcessing is true');
    }
  }
  if (!instant) {
    if (typeof m.stateless !== 'boolean') p.push('stateless (true or false) is required for every app except INSTANT');
    else if (m.stateless === false && !(Array.isArray(m.volumes) && m.volumes.length === 1)) {
      p.push('a stateful app (stateless: false) must declare exactly one data volume');
    }
  }
  return p;
}

/** Every declared scope is in the catalog with the declared context and execution context. */
function catalogProblems(m, catalog) {
  const byScope = new Map(catalog.scopes.map((s) => [s.scope, s]));
  const p = [];
  for (const perm of Array.isArray(m.permissions) ? m.permissions : []) {
    if (!isObject(perm)) continue;
    const entry = byScope.get(perm.scope);
    if (!entry) {
      p.push(`${perm.scope} is not in the permission catalog`);
      continue;
    }
    if (!entry.contexts.includes(perm.context)) p.push(`${perm.scope} is not allowed in context "${perm.context}" (allowed: ${entry.contexts.join(', ')})`);
    const wanted = perm.executionContext === 'both' ? ['user', 'background'] : [perm.executionContext];
    const bad = wanted.filter((c) => !entry.executionContexts.includes(c));
    if (bad.length) {
      const allowed = entry.executionContexts.filter((c) => c !== 'both').join(', ');
      p.push(`${perm.scope} is not allowed with executionContext "${perm.executionContext}" (allowed: ${allowed})`);
    }
  }
  return p;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name !== 'node_modules') walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Host tools the UI source uses (app-react hooks and literal tool names), and the scopes they need. */
function uiHostToolProblems(appDir, declaredScopes, hostTools) {
  const uiDir = existsSync(join(appDir, 'src', 'ui')) ? join(appDir, 'src', 'ui') : join(appDir, 'src');
  if (!existsSync(uiDir)) return { problems: [], used: 0, scanned: 0 };
  const files = walk(uiDir);
  const scopeOf = new Map(hostTools.tools.map((t) => [t.hostTool, t.scope]));
  const problems = [];
  const used = new Set();
  const need = (tool, how, file) => {
    const name = tool.replace(/^mcpapp\./, 'privos.');
    used.add(name);
    const where = `${file} (${how})`;
    if (!scopeOf.has(name)) return problems.push(`${where}: ${tool} is not a Hub host tool`);
    const scope = scopeOf.get(name);
    if (scope && !declaredScopes.has(scope)) problems.push(`${where}: ${name} needs scope ${scope}, which privos-app.json does not declare`);
  };
  for (const path of files) {
    const file = path.slice(appDir.length + 1);
    const src = stripComments(readFileSync(path, 'utf8'));
    for (const hook of hostTools.hooks) {
      if (!new RegExp(`\\b${hook.hook}\\s*[(<]`).test(src)) continue;
      if (hook.broken) problems.push(`${file}: ${hook.hook} is broken - ${hook.note}`);
      else need(hook.hostTool, hook.hook, file);
    }
    for (const m of src.matchAll(/usePrivosTool\s*(?:<[^>()]*>)?\s*\(\s*['"`]((?:privos|mcpapp)\.[^'"`]+)['"`]/g)) need(m[1], 'usePrivosTool', file);
    for (const m of src.matchAll(/callServerTool\s*\(\s*\{[^}]*?name\s*:\s*['"`]((?:privos|mcpapp)\.[^'"`]+)['"`]/g)) need(m[1], 'callServerTool', file);
  }
  return { problems, used: used.size, scanned: files.length };
}

function git(appDir, args) {
  return spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8' });
}

function trackedFileProblems(appDir) {
  const ls = git(appDir, ['ls-files', '-s', '-z']);
  if (ls.status !== 0) return [`git ls-files failed: ${oneLine(ls.stderr)}`];
  const p = [];
  for (const line of ls.stdout.split('\0').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    const base = basename(path);
    if (meta.startsWith('120000')) p.push(`${path}: symlinks are refused in the archive`);
    else if (base.startsWith('privos-standalone-identity')) p.push(`${path}: pairing identity file is tracked`);
    else if ((base.startsWith('.env') && base !== '.env.example') || base.endsWith('.env')) p.push(`${path}: env file is tracked`);
    else if (/\.(pem|key|p12|pfx)$/.test(base) || base.startsWith('id_rsa') || base === '.npmrc') p.push(`${path}: key or credential file is tracked`);
  }
  return p;
}

/** All checks that only read the repository. Returns [{status, check, reason}]. */
export function runStaticChecks(appDirArg, data = loadData()) {
  const appDir = realpathSync(resolve(appDirArg));
  const out = [];

  const top = git(appDir, ['rev-parse', '--show-toplevel']);
  const root = top.status === 0 ? realpathSync(top.stdout.trim()) : null;
  if (root !== appDir) out.push(fail('repo-root', 'the app directory is not a git repository root (publishing archives the repository root); run git init here'));
  else if (git(appDir, ['rev-parse', '-q', '--verify', 'HEAD']).status !== 0) out.push(fail('repo-root', 'the repository has no commit yet'));
  else out.push(pass('repo-root', 'the app directory is its own git repository'));
  if (root === appDir) {
    const dirty = git(appDir, ['status', '--porcelain']).stdout.split('\n').filter(Boolean);
    out.push(dirty.length ? fail('tree-clean', `${dirty.length} uncommitted or untracked path(s), for example ${dirty[0].trim()}`) : pass('tree-clean', 'no uncommitted changes'));
  } else out.push(skip('tree-clean', 'not a repository root'));

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(appDir, 'privos-app.json'), 'utf8'));
    if (!isObject(manifest)) throw new Error('not a JSON object');
  } catch (error) {
    out.push(fail('manifest', `privos-app.json cannot be read: ${error.message}`));
    return out;
  }
  out.push(pass('manifest', 'privos-app.json parsed'));

  let pkg = null;
  try {
    pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  } catch (error) {
    out.push(fail('name-version', `package.json cannot be read: ${error.message}`));
  }
  if (pkg) {
    const problems = [];
    if (pkg.name !== manifest.name) problems.push(`name differs (package.json ${JSON.stringify(pkg.name)}, privos-app.json ${JSON.stringify(manifest.name)})`);
    if (pkg.version !== manifest.version) problems.push(`version differs (package.json ${JSON.stringify(pkg.version)}, privos-app.json ${JSON.stringify(manifest.version)})`);
    out.push(verdict('name-version', problems, `${manifest.name}@${manifest.version} in both files`));
  }

  const id = typeof manifest.name === 'string' ? manifest.name : '';
  const idProblems = [];
  if (/^com\.(example|privos)\./.test(id)) idProblems.push(`${id} is a placeholder or reserved id (com.example.* and com.privos.* are refused); pick your own reverse-domain id`);
  if (!NAME_RULE.test(id)) idProblems.push(`id must match ${NAME_RULE}`);
  else if (!SLUG_RULE.test(listingSlug(id))) idProblems.push(`the listing slug "${listingSlug(id)}" derived from the id must be 2-63 characters of a-z, 0-9 and "-"; shorten the id`);
  out.push(verdict('app-id', idProblems, `${id}, listing slug ${listingSlug(id)}`));

  out.push(verdict('manifest-fields', manifestFieldProblems(manifest), 'top-level keys, tools and ui follow the Portal schema'));
  out.push(verdict('manifest-permissions', manifestPermissionProblems(manifest), 'reason, degradedBehavior and feature are valid'));
  out.push(verdict('manifest-data', manifestDataProblems(manifest), manifest.executionMode === 'INSTANT' ? 'INSTANT app: dataPolicy optional' : 'dataPolicy and stateless declared'));
  out.push(verdict('catalog-scopes', catalogProblems(manifest, data.catalog), `every scope is in the catalog (${data.catalog.catalogVersion}) with an allowed context`));

  const declared = new Set((Array.isArray(manifest.permissions) ? manifest.permissions : []).map((x) => x?.scope));
  const ui = uiHostToolProblems(appDir, declared, data.hostTools);
  out.push(verdict('ui-host-tools', ui.problems, `${ui.used} host tool(s) used in ${ui.scanned} UI file(s), each scope declared`));

  if (root === appDir) {
    out.push(verdict('tracked-files', trackedFileProblems(appDir), 'no identity file, env file, key file or symlink is tracked'));
    const lock = git(appDir, ['ls-files', '--error-unmatch', 'package-lock.json']);
    out.push(lock.status === 0 ? pass('lockfile', 'package-lock.json is tracked') : fail('lockfile', 'package-lock.json is not tracked; the marketplace build runs npm ci'));
  } else {
    out.push(skip('tracked-files', 'not a repository root'));
    out.push(skip('lockfile', 'not a repository root'));
  }
  return out;
}

// --- commands -----------------------------------------------------------------

function cleanEnv() {
  const env = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  return env;
}

function runCommand(appDir, args, timeout = COMMAND_TIMEOUT_MS) {
  const r = spawnSync('npm', args, { cwd: appDir, env: cleanEnv(), encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const text = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const ok = r.status === 0;
  const tail = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ');
  const why = r.error ? r.error.message : `exit ${r.status ?? r.signal}: ${tail}`;
  return { ok, text, why };
}

function runCommandGroup(appDir) {
  const steps = [
    ['npm-test', ['test'], 'npm test passed'],
    ['typecheck', ['run', 'typecheck'], 'npm run typecheck passed'],
    ['build', ['run', 'build'], 'the production bundle built'],
    ['manifest-lint-publish', ['run', 'manifest:lint:publish'], 'the publish-mode manifest lint passed'],
  ];
  const out = [];
  let stopped = null;
  for (const [check, args, okReason] of steps) {
    if (stopped) {
      out.push(skip(check, `not run: ${stopped} failed`));
      continue;
    }
    const r = runCommand(appDir, args);
    out.push(r.ok ? pass(check, okReason) : fail(check, `npm ${args.join(' ')} failed (${r.why})`));
    if (!r.ok) stopped = check;
  }
  if (stopped) {
    out.push(skip('publish-dry-run', `not run: ${stopped} failed`));
    return { out, built: false };
  }
  const hashes = [];
  for (let i = 0; i < 2; i++) {
    const r = runCommand(appDir, ['run', 'publish:marketplace', '--', '--dry-run'], 5 * 60 * 1000);
    if (!r.ok) {
      out.push(fail('publish-dry-run', `dry-run ${i + 1} failed (${r.why})`));
      return { out, built: true };
    }
    hashes.push(r.text.match(/sha256:?\s*([0-9a-f]{64})/i)?.[1] ?? null);
  }
  if (!hashes[0] || hashes[0] !== hashes[1]) out.push(fail('publish-dry-run', `the two dry-runs do not print the same sha256 (${hashes[0]} and ${hashes[1]})`));
  else out.push(pass('publish-dry-run', `twice, archive sha256 ${hashes[0].slice(0, 16)}...`));
  return { out, built: true };
}

// --- server -------------------------------------------------------------------

const cleanups = [];
const runCleanups = () => { while (cleanups.length) { try { cleanups.pop()(); } catch { /* best effort */ } } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { runCleanups(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  });
}

async function rpc(port, method, params) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* reported by the caller */ }
  return { status: response.status, body, text };
}

function uiResourceUris(manifest) {
  const uris = new Set();
  for (const tool of manifest.tools ?? []) if (tool?.ui?.resourceUri) uris.add(tool.ui.resourceUri);
  for (const entry of Object.values(manifest.ui?.entryPoints ?? {})) if (entry?.resourceUri) uris.add(entry.resourceUri);
  return [...uris];
}

async function checkServerMcp(appDir, manifest) {
  const check = 'server-mcp';
  const port = await freePort();
  const scratch = mkdtempSync(join(tmpdir(), 'privos-preflight-'));
  const env = cleanEnv();
  // Never let a paired app's identity file or a platform variable turn this into a real Relay connection.
  for (const key of Object.keys(env)) if (key.startsWith('PRIVOS_')) delete env[key];
  env.PRIVOS_STANDALONE_IDENTITY_FILE = join(scratch, 'no-identity.json');
  env.PORT = String(port);
  const child = spawn('npm', ['start'], { cwd: appDir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => { log = (log + d).slice(-4000); });
  let exited = null;
  child.on('exit', (code, signal) => { exited = code ?? signal; });
  const stop = () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    rmSync(scratch, { recursive: true, force: true });
  };
  cleanups.push(stop);
  try {
    let up = false;
    for (let i = 0; i < 60 && exited === null; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) })).ok) { up = true; break; }
      } catch { /* not listening yet */ }
      await sleep(500);
    }
    if (!up) return fail(check, `npm start did not answer /health on port ${port} (${exited === null ? 'timeout' : `exited ${exited}`}): ${oneLine(log, 200)}`);

    const init = await rpc(port, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'preflight', version: '1' } });
    if (init.status !== 200 || !isObject(init.body?.result)) return fail(check, `initialize did not return a result (HTTP ${init.status}): ${oneLine(init.text, 160)}`);

    const list = await rpc(port, 'tools/list', {});
    const listed = list.body?.result?.tools;
    if (list.status !== 200 || !Array.isArray(listed)) return fail(check, `tools/list did not return a tool list (HTTP ${list.status}): ${oneLine(list.text, 160)}`);
    const missing = (manifest.tools ?? []).map((t) => t.name).filter((n) => !listed.some((t) => t.name === n));
    if (missing.length) return fail(check, `tools/list lacks manifest tool(s): ${missing.join(', ')}`);

    const uris = uiResourceUris(manifest);
    for (const uri of uris) {
      const read = await rpc(port, 'resources/read', { uri });
      const content = read.body?.result?.contents?.[0];
      if (read.status !== 200 || !content || !(content.text || content.blob)) return fail(check, `resources/read ${uri} returned no content (HTTP ${read.status}): ${oneLine(read.text, 160)}`);
    }

    for (const tool of manifest.tools ?? []) {
      const call = await rpc(port, 'tools/call', { name: tool.name, arguments: {} });
      const ok = call.status === 200 && call.body && (call.body.result !== undefined || isObject(call.body.error));
      if (!ok) return fail(check, `tools/call ${tool.name} crashed (HTTP ${call.status}): ${oneLine(call.text, 160)}`);
    }
    if (exited !== null) return fail(check, `the server exited (${exited}) during the checks`);
    return pass(check, `initialize, tools/list, ${uris.length} ui resource(s) and ${(manifest.tools ?? []).length} tool call(s) answered on port ${port}`);
  } catch (error) {
    return fail(check, `${error.message}: ${oneLine(log, 160)}`);
  } finally {
    stop();
    cleanups.splice(cleanups.indexOf(stop), 1);
  }
}

// --- docker -------------------------------------------------------------------

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function dockerRunner() {
  const direct = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20_000 });
  if (direct.status === 0) return (args, timeout) => spawnSync('docker', args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const viaSg = spawnSync('sg', ['docker', '-c', 'docker info'], { stdio: 'ignore', timeout: 20_000 });
  if (viaSg.status === 0) {
    return (args, timeout) => spawnSync('sg', ['docker', '-c', ['docker', ...args].map(shq).join(' ')], { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  }
  return null;
}

function availableMemoryGb() {
  try {
    const kb = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1]);
    return Number.isFinite(kb) ? kb / 1024 / 1024 : Infinity; // no /proc: do not block
  } catch { return Infinity; }
}

async function checkDockerImage(appDir, manifest) {
  const check = 'docker-image';
  const docker = dockerRunner();
  if (!docker) return skip(check, 'docker is not reachable, so the bare image run was not checked');
  const mem = availableMemoryGb();
  if (mem < 6) return skip(check, `only ${mem.toFixed(1)} GB of memory available, need 6 for a docker build`);
  if (!existsSync(join(appDir, 'Dockerfile'))) return fail(check, 'a server app needs a Dockerfile at the repository root');

  const id = `${Date.now()}-${process.pid}`;
  const tag = `privos-preflight:${id}`;
  const label = `privos-preflight=${id}`;
  let cid = '';
  const cleanup = () => {
    if (cid) docker(['rm', '-f', cid], 60_000);
    docker(['image', 'rm', '-f', tag], 60_000);
  };
  cleanups.push(cleanup);
  try {
    const build = docker(['build', '--label', label, '-t', tag, appDir], COMMAND_TIMEOUT_MS);
    if (build.status !== 0) {
      const tail = `${build.stdout}\n${build.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' | ');
      return fail(check, `docker build failed: ${tail}`);
    }
    const run = docker(['run', '-d', '--label', label, ...HARDENING, tag], 120_000);
    if (run.status !== 0) return fail(check, `docker run failed: ${oneLine(run.stderr, 200)}`);
    cid = run.stdout.trim();
    const inspect = (format, target = cid) => docker(['inspect', target, '--format', format], 30_000).stdout.trim();
    const ip = inspect('{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}');
    const exposed = inspect('{{range $p, $_ := .Config.ExposedPorts}}{{println $p}}{{end}}', tag).split('\n').map((l) => l.match(/^\d+/)?.[0]);
    const envPort = inspect('{{range .Config.Env}}{{println .}}{{end}}', tag).match(/^PORT=(\d+)$/m)?.[1];
    const ports = [...new Set([...exposed, envPort, '8080', '3000'].filter(Boolean))];
    if (!ip) return fail(check, 'the container has no network address; it may have exited');
    for (let i = 0; i < 30; i++) {
      for (const port of ports) {
        try {
          const response = await fetch(`http://${ip}:${port}/.well-known/mcp/manifest.json`, { signal: AbortSignal.timeout(2000) });
          if (!response.ok) continue;
          const served = await response.json();
          if (JSON.stringify(sortKeys(served)) !== JSON.stringify(sortKeys(manifest))) return fail(check, 'the served manifest differs from privos-app.json');
          return pass(check, `the bare hardened image served its manifest on port ${port}`);
        } catch { /* not up yet */ }
      }
      await sleep(1000);
    }
    const logs = docker(['logs', '--tail', '3', cid], 30_000);
    return fail(check, `the bare image did not serve /.well-known/mcp/manifest.json within 30 s (tried ports ${ports.join(', ')}): ${oneLine(`${logs.stdout} ${logs.stderr}`, 200)}`);
  } finally {
    cleanup();
    cleanups.splice(cleanups.indexOf(cleanup), 1);
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  return value;
}

// --- main ---------------------------------------------------------------------

function exitCodeFor(results) {
  if (results.some((r) => r.status === 'FAIL')) return 2;
  return results.some((r) => r.status === 'SKIPPED') ? 3 : 0;
}

async function main() {
  const target = process.argv[2] ?? process.cwd();
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    console.error(`usage: node preflight.mjs [app-dir]  (not a directory: ${target})`);
    return 1;
  }
  const appDir = realpathSync(resolve(target));
  const all = [];
  const emit = (list) => { for (const r of list) { console.log(`${r.status} ${r.check} ${r.reason}`); all.push(r); } };

  emit(runStaticChecks(appDir));
  const manifest = all.some((r) => r.check === 'manifest' && r.status === 'PASS') ? JSON.parse(readFileSync(join(appDir, 'privos-app.json'), 'utf8')) : null;
  if (!manifest) {
    emit([skip('commands', 'privos-app.json is unreadable')]);
    return exitCodeFor(all);
  }

  const { out, built } = runCommandGroup(appDir);
  emit(out);

  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')); } catch { /* reported by name-version */ }
  const serverApp = manifest.executionMode !== 'INSTANT' && Boolean(pkg.scripts?.start);
  if (!serverApp) {
    emit([pass('server-mcp', 'not applicable: not a server app'), pass('docker-image', 'not applicable: not a server app')]);
  } else {
    emit([built ? await checkServerMcp(appDir, manifest) : skip('server-mcp', 'the build did not pass, so there is nothing to start')]);
    emit([await checkDockerImage(appDir, manifest)]);
  }
  return exitCodeFor(all);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { runCleanups(); process.exitCode = code; }, (error) => {
    runCleanups();
    console.error(error);
    process.exitCode = 1;
  });
}
