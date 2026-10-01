import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listingSlug, loadData, runStaticChecks } from './preflight.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOD = join(HERE, 'fixtures', 'good');
const data = loadData();
const scratch = mkdtempSync(join(tmpdir(), 'preflight-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=test', '-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

let counter = 0;
/** Copy the good fixture into its own repository; `change(dir)` edits it before the commit. */
function app(change = () => {}, { commit = true } = {}) {
  const dir = join(scratch, `app-${counter++}`);
  cpSync(GOOD, dir, { recursive: true });
  change(dir);
  git(dir, 'init', '-q', '-b', 'main');
  if (commit) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

const editManifest = (edit) => (dir) => {
  const file = join(dir, 'privos-app.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  edit(manifest);
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  const pkgFile = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  Object.assign(pkg, { name: manifest.name, version: manifest.version });
  writeFileSync(pkgFile, JSON.stringify(pkg));
};

const run = (dir) => runStaticChecks(dir, data);
const get = (results, check) => results.find((r) => r.check === check);
const failing = (results) => results.filter((r) => r.status === 'FAIL').map((r) => r.check);

describe('static checks', () => {
  it('a good manifest passes every static check', () => {
    const results = run(app());
    assert.deepEqual(failing(results), [], JSON.stringify(results.filter((r) => r.status !== 'PASS')));
    assert.ok(results.every((r) => r.status === 'PASS'));
  });

  it('a runtime manifest without dataPolicy fails', () => {
    const results = run(app(editManifest((m) => { delete m.dataPolicy; })));
    assert.equal(get(results, 'manifest-data').status, 'FAIL');
    assert.match(get(results, 'manifest-data').reason, /dataPolicy is required/);
  });

  it('an INSTANT manifest without dataPolicy or stateless is fine', () => {
    const results = run(app(editManifest((m) => { delete m.dataPolicy; delete m.stateless; m.executionMode = 'INSTANT'; })));
    assert.equal(get(results, 'manifest-data').status, 'PASS');
  });

  it('a placeholder id fails', () => {
    const results = run(app(editManifest((m) => { m.name = 'com.example.x'; })));
    assert.equal(get(results, 'app-id').status, 'FAIL');
    assert.match(get(results, 'app-id').reason, /placeholder/);
  });

  it('a reserved com.privos id fails', () => {
    assert.equal(get(run(app(editManifest((m) => { m.name = 'com.privos.notes'; }))), 'app-id').status, 'FAIL');
  });

  it('an id whose listing slug exceeds 63 characters fails', () => {
    const results = run(app(editManifest((m) => { m.name = `dev.fixture.${'a'.repeat(60)}`; })));
    assert.match(get(results, 'app-id').reason, /listing slug/);
  });

  it('derives the listing slug the way the Portal does', () => {
    assert.equal(listingSlug('ai.privos.mcp-app-demo'), 'ai-privos-mcp-app-demo');
  });

  it('name and version must agree with package.json', () => {
    const dir = app((d) => writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'dev.fixture.notes', version: '9.9.9' })));
    assert.match(get(run(dir), 'name-version').reason, /version differs/);
  });

  it('a UI that calls a host tool whose scope is not declared fails', () => {
    const results = run(app(editManifest((m) => { m.permissions = m.permissions.filter((p) => p.scope !== 'rooms:read'); })));
    const check = get(results, 'ui-host-tools');
    assert.equal(check.status, 'FAIL');
    assert.match(check.reason, /privos\.rooms\.get needs scope rooms:read/);
  });

  it('a hook-based call needs its scope too, and callServerTool names are scanned', () => {
    const dir = app((d) => writeFileSync(join(d, 'src', 'ui', 'App.tsx'), "app.callServerTool({ name: 'privos.files.getByChannel', arguments: {} });\n"));
    assert.match(get(run(dir), 'ui-host-tools').reason, /files:read/);
  });

  it('a host tool that is not on the Hub fails', () => {
    const dir = app((d) => writeFileSync(join(d, 'src', 'ui', 'App.tsx'), "usePrivosTool('privos.nothing.here');\n"));
    assert.match(get(run(dir), 'ui-host-tools').reason, /not a Hub host tool/);
  });

  it('useFiles fails with the broken-hook note', () => {
    const dir = app((d) => writeFileSync(join(d, 'src', 'ui', 'Files.tsx'), "import { useFiles } from '@privos_ai/app-react';\nexport const F = () => useFiles('r');\n"));
    const check = get(run(dir), 'ui-host-tools');
    assert.equal(check.status, 'FAIL');
    assert.match(check.reason, /useFiles is broken/);
    assert.match(check.reason, /getByChannel/);
  });

  it('a mention of useFiles in a comment does not fail', () => {
    const dir = app((d) => writeFileSync(join(d, 'src', 'ui', 'Note.tsx'), '// do not use useFiles( here\nexport const N = 1;\n'));
    assert.equal(get(run(dir), 'ui-host-tools').status, 'PASS');
  });

  it('a tracked identity file fails', () => {
    const dir = app((d) => writeFileSync(join(d, 'privos-standalone-identity.json'), '{}'));
    assert.match(get(run(dir), 'tracked-files').reason, /privos-standalone-identity\.json/);
  });

  it('a tracked env file, key file or symlink fails; .env.example is fine', () => {
    const dir = app((d) => {
      writeFileSync(join(d, '.env.example'), 'A=\n');
      writeFileSync(join(d, '.env.local'), 'A=1\n');
      writeFileSync(join(d, 'server.pem'), 'x');
      symlinkSync('package.json', join(d, 'link.json'));
    });
    const reason = get(run(dir), 'tracked-files').reason;
    assert.match(reason, /\.env\.local/);
    assert.match(reason, /server\.pem/);
    assert.match(reason, /link\.json: symlinks/);
    assert.doesNotMatch(reason, /\.env\.example/);
  });

  it('an untracked lockfile fails', () => {
    const dir = app((d) => { rmSync(join(d, 'package-lock.json')); });
    assert.equal(get(run(dir), 'lockfile').status, 'FAIL');
  });

  it('a dirty tree and a missing repository root fail', () => {
    const dirty = app();
    writeFileSync(join(dirty, 'notes.txt'), 'x');
    assert.equal(get(run(dirty), 'tree-clean').status, 'FAIL');

    const nested = join(app(), 'inner');
    mkdirSync(nested);
    cpSync(GOOD, nested, { recursive: true });
    assert.equal(get(run(nested), 'repo-root').status, 'FAIL');
  });

  it('the stricter Portal rules: reason, degradedBehavior, feature and unknown keys', () => {
    const results = run(app(editManifest((m) => {
      m.permissions[0].reason = 'short';
      m.permissions[0].degradedBehavior = 'A required permission must not have this.';
      delete m.permissions[1].degradedBehavior;
      m.permissions[2].feature = 'Bad Feature';
      m.runtimeTrustProvisioningUrl = 'https://example.invalid';
      m.tools[0].title = '';
      m.tools[0].extra = 1;
    })));
    const permissions = get(results, 'manifest-permissions').reason;
    assert.match(permissions, /reason must be 10-1000/);
    assert.match(permissions, /required permission cannot declare degradedBehavior/);
    assert.match(permissions, /optional permission needs degradedBehavior/);
    assert.match(permissions, /feature must match/);
    const fields = get(results, 'manifest-fields').reason;
    assert.match(fields, /runtimeTrustProvisioningUrl/);
    assert.match(fields, /title is required/);
    assert.match(fields, /unknown key "extra"/);
  });

  it('a scope outside the catalog, or in a context it does not allow, fails', () => {
    const unknown = run(app(editManifest((m) => { m.permissions[0].scope = 'made:up'; })));
    assert.match(get(unknown, 'catalog-scopes').reason, /made:up is not in the permission catalog/);
    const badContext = run(app(editManifest((m) => { m.permissions[2].executionContext = 'background'; })));
    assert.match(get(badContext, 'catalog-scopes').reason, /rooms:read is not allowed with executionContext "background"/);
  });
});

describe('command line', () => {
  it('prints one line per check and exits 2 when a static check fails', () => {
    const dir = app(editManifest((m) => { m.name = 'com.example.x'; }));
    const r = spawnSync('node', [join(HERE, 'preflight.mjs'), dir], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 2);
    const lines = r.stdout.trim().split('\n');
    assert.ok(lines.every((l) => /^(PASS|FAIL|SKIPPED) [a-z-]+ /.test(l)), r.stdout);
    assert.ok(lines.some((l) => l.startsWith('FAIL app-id ')));
    // npm test has no script in the fixture, so the command group reports it and skips the rest.
    assert.ok(lines.some((l) => l.startsWith('SKIPPED typecheck ')));
  });

  it('exits 1 for a directory that does not exist', () => {
    const r = spawnSync('node', [join(HERE, 'preflight.mjs'), join(scratch, 'missing')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
  });
});
