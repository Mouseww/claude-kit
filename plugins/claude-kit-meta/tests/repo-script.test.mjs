// Tests for scripts/repo-script.mjs, the launcher commands use to reach the
// real marketplace repo's scripts/ directory from an installed plugin copy.
//
//   node --test "plugins/**/tests/*.test.mjs"
//
// resolveRepoRoot() reads ~/.claude/plugins/known_marketplaces.json, so every
// test that exercises marketplace-entry resolution runs the script as a
// child process with HOME/USERPROFILE pointed at a throwaway directory.
// Never touches the real ~/.claude.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/repo-script.mjs', import.meta.url));
const MARKETPLACE_SOURCE_PATH = fileURLToPath(new URL('../scripts/marketplace-source.mjs', import.meta.url));
// plugins/claude-kit-meta/tests -> plugins/claude-kit-meta -> plugins -> repo root
const REAL_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/, '');

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'ck-repo-script-'));
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  return home;
}

function cleanupHome(home) {
  rmSync(home, { recursive: true, force: true });
}

function writeKnownMarketplaces(home, data) {
  writeFileSync(
    join(home, '.claude', 'plugins', 'known_marketplaces.json'),
    JSON.stringify(data),
  );
}

// A minimal fake marketplace checkout: just enough for hasMarketplaceManifest
// to accept it, plus a script the launcher can spawn.
function makeFakeRepo(root) {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), '{}');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(
    join(root, 'scripts', 'echo-args.mjs'),
    [
      "const args = process.argv.slice(2);",
      "process.stdout.write(JSON.stringify(args));",
      "process.exit(args.includes('fail') ? 7 : 0);",
    ].join('\n'),
  );
}

function run(home, args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('resolveRepoRoot: resolves via installLocation', () => {
  const home = makeHome();
  try {
    const fakeRepo = mkdtempSync(join(tmpdir(), 'ck-fake-repo-'));
    makeFakeRepo(fakeRepo);
    writeKnownMarketplaces(home, {
      'claude-kit': {
        source: { source: 'github', repo: 'someone/claude-kit' },
        installLocation: fakeRepo,
      },
    });

    const r = run(home, ['--root']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), fakeRepo);

    rmSync(fakeRepo, { recursive: true, force: true });
  } finally {
    cleanupHome(home);
  }
});

test('resolveRepoRoot: resolves via directory source.path when no installLocation', () => {
  const home = makeHome();
  try {
    const fakeRepo = mkdtempSync(join(tmpdir(), 'ck-fake-repo-'));
    makeFakeRepo(fakeRepo);
    writeKnownMarketplaces(home, {
      'claude-kit': {
        source: { source: 'directory', path: fakeRepo },
      },
    });

    const r = run(home, ['--root']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), fakeRepo);

    rmSync(fakeRepo, { recursive: true, force: true });
  } finally {
    cleanupHome(home);
  }
});

test('resolveRepoRoot: falls back to the repo checkout when no known_marketplaces.json entry qualifies', () => {
  const home = makeHome();
  try {
    // No known_marketplaces.json at all.
    const r = run(home, ['--root']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), REAL_REPO_ROOT);
  } finally {
    cleanupHome(home);
  }
});

test('resolveRepoRoot: falls back when the listed entry does not hold a real checkout', () => {
  const home = makeHome();
  try {
    writeKnownMarketplaces(home, {
      'claude-kit': {
        source: { source: 'directory', path: join(tmpdir(), 'does-not-exist-at-all') },
      },
    });

    const r = run(home, ['--root']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), REAL_REPO_ROOT);
  } finally {
    cleanupHome(home);
  }
});

test('rejects a script name that is not a bare lower-kebab-case token', () => {
  const home = makeHome();
  try {
    const r = run(home, ['../secrets/whatever']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not a valid script name/);
  } finally {
    cleanupHome(home);
  }
});

test('errors clearly when no candidate root qualifies at all', () => {
  const home = makeHome();
  try {
    writeKnownMarketplaces(home, {
      'claude-kit': {
        source: { source: 'directory', path: join(tmpdir(), 'still-does-not-exist') },
      },
    });

    // Point the fallback at nowhere by running from a copy of the script
    // outside any repo checkout, so even the "<plugin root>/../.." fallback
    // fails to find a marketplace.json.
    const isolatedDir = mkdtempSync(join(tmpdir(), 'ck-isolated-'));
    const isolatedScriptsDir = join(isolatedDir, 'plugins', 'claude-kit-meta', 'scripts');
    mkdirSync(isolatedScriptsDir, { recursive: true });
    const isolatedScript = join(isolatedScriptsDir, 'repo-script.mjs');
    copyFileSync(SCRIPT_PATH, isolatedScript);
    // marketplace-source.mjs is a sibling import; copy it too.
    copyFileSync(MARKETPLACE_SOURCE_PATH, join(isolatedScriptsDir, 'marketplace-source.mjs'));

    const r = spawnSync(process.execPath, [isolatedScript, '--root'], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /could not find the claude-kit marketplace repository/);

    rmSync(isolatedDir, { recursive: true, force: true });
  } finally {
    cleanupHome(home);
  }
});

test('runs the named script with args and exit code passed through', () => {
  const home = makeHome();
  try {
    const fakeRepo = mkdtempSync(join(tmpdir(), 'ck-fake-repo-'));
    makeFakeRepo(fakeRepo);
    writeKnownMarketplaces(home, {
      'claude-kit': { installLocation: fakeRepo },
    });

    const r = run(home, ['echo-args', 'foo', 'bar']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), ['foo', 'bar']);

    const rFail = run(home, ['echo-args', 'fail']);
    assert.equal(rFail.status, 7);

    rmSync(fakeRepo, { recursive: true, force: true });
  } finally {
    cleanupHome(home);
  }
});

test('errors when the requested script does not exist in the resolved repo', () => {
  const home = makeHome();
  try {
    const fakeRepo = mkdtempSync(join(tmpdir(), 'ck-fake-repo-'));
    makeFakeRepo(fakeRepo);
    writeKnownMarketplaces(home, {
      'claude-kit': { installLocation: fakeRepo },
    });

    const r = run(home, ['no-such-script']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no such script/);

    rmSync(fakeRepo, { recursive: true, force: true });
  } finally {
    cleanupHome(home);
  }
});
