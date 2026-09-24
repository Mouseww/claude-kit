// Tests for scripts/check-daily-update.mjs.
//
//   node --test "plugins/**/tests/*.test.mjs"
//
// The module's paths (CLAUDE_DIR, LOCK_FILE, FLAG_FILE, CACHE_DIR, ...) are
// constants computed from os.homedir() at import time, so the only way to
// point them at a throwaway directory is to run the module in a child
// process with HOME/USERPROFILE overridden before it is imported. Pure
// helpers (compareSemver, today) don't touch the filesystem and are imported
// directly in this process instead.
//
// Never touches the real ~/.claude, makes no network calls, and never
// spawns the real `claude` binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareSemver, today } from '../scripts/check-daily-update.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/check-daily-update.mjs', import.meta.url));
const SCRIPT_URL = pathToFileURL(SCRIPT_PATH).href;

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'ck-update-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  return home;
}

function cleanupHome(home) {
  rmSync(home, { recursive: true, force: true });
}

// Runs `code` as an ESM module in a child process with HOME/USERPROFILE
// pointed at `home`, so os.homedir() (and every constant derived from it in
// the module under test) resolves inside the throwaway directory. Because
// process.argv[1] in that child is this eval script, not check-daily-update
// itself, isMainModule() is false and the import never runs main() or
// touches stdin.
function evalInChild(home, code) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return result;
}

function callExport(home, exportName, argsJson) {
  const code = `
    import { ${exportName} } from ${JSON.stringify(SCRIPT_URL)};
    const result = ${exportName}(...${argsJson});
    process.stdout.write(JSON.stringify({ result }));
  `;
  const r = evalInChild(home, code);
  assert.equal(r.status, 0, `child failed: ${r.stderr}`);
  return JSON.parse(r.stdout).result;
}

// -----------------------------------------------------------------------
// compareSemver (pure, no homedir dependency)
// -----------------------------------------------------------------------

test('compareSemver: 1.10.0 sorts after 1.9.0', () => {
  assert.ok(compareSemver('1.10.0', '1.9.0') > 0);
});

test('compareSemver: equal versions compare equal', () => {
  assert.equal(compareSemver('2.3.1', '2.3.1'), 0);
});

test('compareSemver: shorter version is padded with zeros', () => {
  assert.ok(compareSemver('1.2', '1.2.1') < 0);
});

// -----------------------------------------------------------------------
// acquireLock / releaseLock
// -----------------------------------------------------------------------

test('acquireLock: fresh lock is acquired', () => {
  const home = makeHome();
  try {
    const acquired = callExport(home, 'acquireLock', '[]');
    assert.equal(acquired, true);
    assert.ok(existsSync(join(home, '.claude', 'claude-kit-update.lock')));
  } finally {
    cleanupHome(home);
  }
});

test('acquireLock: held lock is refused', () => {
  const home = makeHome();
  try {
    const lockFile = join(home, '.claude', 'claude-kit-update.lock');
    writeFileSync(lockFile, '');
    const acquired = callExport(home, 'acquireLock', '[]');
    assert.equal(acquired, false);
  } finally {
    cleanupHome(home);
  }
});

test('acquireLock: stale lock (>120s old) is taken over', () => {
  const home = makeHome();
  try {
    const lockFile = join(home, '.claude', 'claude-kit-update.lock');
    writeFileSync(lockFile, '');
    const staleTime = new Date(Date.now() - 130_000);
    utimesSync(lockFile, staleTime, staleTime);
    const acquired = callExport(home, 'acquireLock', '[]');
    assert.equal(acquired, true);
  } finally {
    cleanupHome(home);
  }
});

test('releaseLock: removes an existing lock file', () => {
  const home = makeHome();
  try {
    const lockFile = join(home, '.claude', 'claude-kit-update.lock');
    writeFileSync(lockFile, '');
    callExport(home, 'releaseLock', '[]');
    assert.equal(existsSync(lockFile), false);
  } finally {
    cleanupHome(home);
  }
});

// -----------------------------------------------------------------------
// readFlag / writeFlag
// -----------------------------------------------------------------------

test('writeFlag then readFlag round-trips', () => {
  const home = makeHome();
  try {
    callExport(home, 'writeFlag', JSON.stringify([{ lastCheck: '2026-01-01', lastCommit: 'abc123' }]));
    const flag = callExport(home, 'readFlag', '[]');
    assert.deepEqual(flag, { lastCheck: '2026-01-01', lastCommit: 'abc123' });
  } finally {
    cleanupHome(home);
  }
});

test('readFlag: missing flag file returns the default shape', () => {
  const home = makeHome();
  try {
    const flag = callExport(home, 'readFlag', '[]');
    assert.deepEqual(flag, { lastCheck: '', lastCommit: '' });
  } finally {
    cleanupHome(home);
  }
});

// -----------------------------------------------------------------------
// getInstalledPlugins
// -----------------------------------------------------------------------

test('getInstalledPlugins: rejects names that fail the safe-name pattern', () => {
  const home = makeHome();
  try {
    const cacheDir = join(home, '.claude', 'plugins', 'cache', 'claude-kit');
    mkdirSync(join(cacheDir, 'dev-agents'), { recursive: true });
    mkdirSync(join(cacheDir, 'not a plugin!'), { recursive: true });
    const plugins = callExport(home, 'getInstalledPlugins', '[]');
    assert.deepEqual(plugins.sort(), ['dev-agents']);
  } finally {
    cleanupHome(home);
  }
});

test('getInstalledPlugins: empty when the cache dir does not exist', () => {
  const home = makeHome();
  try {
    const plugins = callExport(home, 'getInstalledPlugins', '[]');
    assert.deepEqual(plugins, []);
  } finally {
    cleanupHome(home);
  }
});

// -----------------------------------------------------------------------
// findSyncScript
// -----------------------------------------------------------------------

function makePluginVersionDir(home, pluginName, version) {
  const dir = join(home, '.claude', 'plugins', 'cache', 'claude-kit', pluginName, version);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('findSyncScript: picks the highest version directory', () => {
  const home = makeHome();
  try {
    for (const v of ['1.2.0', '1.10.0', '1.9.0']) {
      const dir = makePluginVersionDir(home, 'dev-agents', v);
      writeFileSync(join(dir, 'claude-md-block.md'), '# block');
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'sync-claude-md.mjs'), '// sync');
    }
    const result = callExport(home, 'findSyncScript', JSON.stringify(['dev-agents']));
    assert.ok(result.endsWith(join('1.10.0', 'scripts', 'sync-claude-md.mjs')));
  } finally {
    cleanupHome(home);
  }
});

test('findSyncScript: null when claude-md-block.md is missing', () => {
  const home = makeHome();
  try {
    const dir = makePluginVersionDir(home, 'dev-agents', '1.0.0');
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'sync-claude-md.mjs'), '// sync');
    const result = callExport(home, 'findSyncScript', JSON.stringify(['dev-agents']));
    assert.equal(result, null);
  } finally {
    cleanupHome(home);
  }
});

test('findSyncScript: null when sync-claude-md.mjs is missing', () => {
  const home = makeHome();
  try {
    const dir = makePluginVersionDir(home, 'dev-agents', '1.0.0');
    writeFileSync(join(dir, 'claude-md-block.md'), '# block');
    const result = callExport(home, 'findSyncScript', JSON.stringify(['dev-agents']));
    assert.equal(result, null);
  } finally {
    cleanupHome(home);
  }
});

test('findSyncScript: null when the plugin is not cached at all', () => {
  const home = makeHome();
  try {
    const result = callExport(home, 'findSyncScript', JSON.stringify(['missing-plugin']));
    assert.equal(result, null);
  } finally {
    cleanupHome(home);
  }
});

// -----------------------------------------------------------------------
// today
// -----------------------------------------------------------------------

test('today: returns an ISO-like YYYY-MM-DD string', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

// -----------------------------------------------------------------------
// Hook entry point: same-day flag short-circuits before touching the lock
// -----------------------------------------------------------------------

test('hook run: same-day flag exits cleanly without acquiring the lock or spawning an update', () => {
  const home = makeHome();
  try {
    writeFileSync(
      join(home, '.claude', 'claude-kit-update-check.json'),
      JSON.stringify({ lastCheck: today(), lastCommit: 'whatever' }),
    );
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      input: '{}',
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
    assert.equal(existsSync(join(home, '.claude', 'claude-kit-update.lock')), false);
  } finally {
    cleanupHome(home);
  }
});

test('hook run: still recognized as main when argv[1] is a relative, differently-cased path', () => {
  // isMainModule() resolves both SCRIPT_PATH and argv[1] through
  // fs.realpathSync.native() before comparing, which is what makes this
  // survive a relative cwd-based path and (on win32) a differently-cased
  // one; a naive string/URL compare would treat these as a different file
  // and main() would silently never run.
  const home = makeHome();
  try {
    writeFileSync(
      join(home, '.claude', 'claude-kit-update-check.json'),
      JSON.stringify({ lastCheck: '2000-01-01', lastCommit: 'whatever' }),
    );
    const lastSlash = Math.max(SCRIPT_PATH.lastIndexOf('/'), SCRIPT_PATH.lastIndexOf('\\'));
    const scriptDir = SCRIPT_PATH.slice(0, lastSlash);
    const scriptName = SCRIPT_PATH.slice(lastSlash + 1);
    // Only the stem is upper-cased, not the ".mjs" extension: Node's ESM
    // loader itself rejects an upper-cased extension (ERR_UNKNOWN_FILE_EXTENSION)
    // regardless of this fix, so a fully upper-cased name would fail for a
    // reason unrelated to isMainModule().
    const dotIndex = scriptName.lastIndexOf('.');
    const casedName = process.platform === 'win32'
      ? scriptName.slice(0, dotIndex).toUpperCase() + scriptName.slice(dotIndex)
      : scriptName;
    const relativeArg = (process.platform === 'win32' ? '.\\' : './') + casedName;
    const result = spawnSync(process.execPath, [relativeArg], {
      cwd: scriptDir,
      input: '{}',
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), '');
    // Observable proof that main() ran: with no known_marketplaces.json it
    // stamps today into the flag file. A skipped main() would leave 2000-01-01.
    const flag = JSON.parse(readFileSync(join(home, '.claude', 'claude-kit-update-check.json'), 'utf8'));
    assert.equal(flag.lastCheck, today());
    assert.equal(existsSync(join(home, '.claude', 'claude-kit-update.lock')), false);
  } finally {
    cleanupHome(home);
  }
});
