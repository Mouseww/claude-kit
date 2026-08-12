// Tests for scripts/marketplace-source.mjs.
//
//   node --test "plugins/**/tests/*.test.mjs"
//
// This module is pure (no process side effects), so it is imported directly
// rather than exercised via spawnSync, unlike sync-claude-md.test.mjs or
// task-plan.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveMarketplaceSource,
  computeDirectoryFingerprint,
} from '../scripts/marketplace-source.mjs';

// -----------------------------------------------------------------------
// resolveMarketplaceSource
// -----------------------------------------------------------------------

test('resolveMarketplaceSource: new-structure github source resolves to an https URL', () => {
  const data = {
    'claude-kit': { source: { source: 'github', repo: 'anthropics/skills' } },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'git', url: 'https://github.com/anthropics/skills.git' });
});

test('resolveMarketplaceSource: new-structure directory source resolves to its path', () => {
  const data = {
    'claude-kit': { source: { source: 'directory', path: 'C:\\repos\\claude-kit' } },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'directory', path: 'C:\\repos\\claude-kit' });
});

test('resolveMarketplaceSource: directory source missing path falls back to installLocation', () => {
  const data = {
    'claude-kit': {
      source: { source: 'directory' },
      installLocation: 'C:\\Users\\me\\claude-kit',
    },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'directory', path: 'C:\\Users\\me\\claude-kit' });
});

test('resolveMarketplaceSource: legacy flat structure (source is a string) resolves the github repo', () => {
  const data = {
    'claude-kit': { source: 'github', repo: 'anthropics/claude-kit' },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'git', url: 'https://github.com/anthropics/claude-kit.git' });
});

test('resolveMarketplaceSource: no matching entry returns null', () => {
  const data = {
    'other-marketplace': { source: { source: 'github', repo: 'someone/other' } },
  };
  assert.equal(resolveMarketplaceSource(data, 'claude-kit'), null);
});

test('resolveMarketplaceSource: null or non-object data returns null', () => {
  assert.equal(resolveMarketplaceSource(null, 'claude-kit'), null);
  assert.equal(resolveMarketplaceSource(undefined, 'claude-kit'), null);
  assert.equal(resolveMarketplaceSource('not-an-object', 'claude-kit'), null);
  assert.equal(resolveMarketplaceSource(42, 'claude-kit'), null);
});

test('resolveMarketplaceSource: matches by repo suffix when the key differs from the name', () => {
  const data = {
    foo: { source: { source: 'github', repo: 'someone/claude-kit' } },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'git', url: 'https://github.com/someone/claude-kit.git' });
});

test('resolveMarketplaceSource: skips an entry that matches by key but lacks usable source info, and uses the next usable one', () => {
  const data = {
    'claude-kit': { source: { source: 'unknown-kind' } },
    'claude-kit-mirror': {
      name: 'claude-kit',
      source: { source: 'github', repo: 'anthropics/claude-kit' },
    },
  };
  const result = resolveMarketplaceSource(data, 'claude-kit');
  assert.deepEqual(result, { kind: 'git', url: 'https://github.com/anthropics/claude-kit.git' });
});

// -----------------------------------------------------------------------
// computeDirectoryFingerprint
// -----------------------------------------------------------------------

let dir;

function writeMarketplace(root, plugins) {
  const manifestDir = path.join(root, '.claude-plugin');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, 'marketplace.json'), JSON.stringify({ plugins }));
}

function writePluginVersion(root, relSource, name, version) {
  const pluginDir = path.join(root, relSource);
  const manifestDir = path.join(pluginDir, '.claude-plugin');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, 'plugin.json'), JSON.stringify({ name, version }));
}

function makeFixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-kit-meta-'));
}

function cleanup(d) {
  fs.rmSync(d, { recursive: true, force: true });
}

test('computeDirectoryFingerprint: returns a 40-char hex sha1 for a normal two-plugin layout', () => {
  dir = makeFixtureDir();
  try {
    writeMarketplace(dir, [
      { name: 'alpha', source: './plugins/alpha' },
      { name: 'beta', source: './plugins/beta' },
    ]);
    writePluginVersion(dir, './plugins/alpha', 'alpha', '1.0.0');
    writePluginVersion(dir, './plugins/beta', 'beta', '2.0.0');

    const fp = computeDirectoryFingerprint(dir);
    assert.equal(typeof fp, 'string');
    assert.match(fp, /^[0-9a-f]{40}$/);
  } finally {
    cleanup(dir);
  }
});

test('computeDirectoryFingerprint: is deterministic across repeated calls', () => {
  dir = makeFixtureDir();
  try {
    writeMarketplace(dir, [
      { name: 'alpha', source: './plugins/alpha' },
      { name: 'beta', source: './plugins/beta' },
    ]);
    writePluginVersion(dir, './plugins/alpha', 'alpha', '1.0.0');
    writePluginVersion(dir, './plugins/beta', 'beta', '2.0.0');

    const first = computeDirectoryFingerprint(dir);
    const second = computeDirectoryFingerprint(dir);
    assert.equal(first, second);
  } finally {
    cleanup(dir);
  }
});

test('computeDirectoryFingerprint: changes when a plugin version changes', () => {
  dir = makeFixtureDir();
  try {
    writeMarketplace(dir, [{ name: 'alpha', source: './plugins/alpha' }]);
    writePluginVersion(dir, './plugins/alpha', 'alpha', '1.0.0');
    const before = computeDirectoryFingerprint(dir);

    writePluginVersion(dir, './plugins/alpha', 'alpha', '1.0.1');
    const after = computeDirectoryFingerprint(dir);

    assert.notEqual(before, after);
  } finally {
    cleanup(dir);
  }
});

test('computeDirectoryFingerprint: is unaffected by the order of the plugins array', () => {
  const dirA = makeFixtureDir();
  const dirB = makeFixtureDir();
  try {
    writeMarketplace(dirA, [
      { name: 'alpha', source: './plugins/alpha' },
      { name: 'beta', source: './plugins/beta' },
    ]);
    writePluginVersion(dirA, './plugins/alpha', 'alpha', '1.0.0');
    writePluginVersion(dirA, './plugins/beta', 'beta', '2.0.0');

    writeMarketplace(dirB, [
      { name: 'beta', source: './plugins/beta' },
      { name: 'alpha', source: './plugins/alpha' },
    ]);
    writePluginVersion(dirB, './plugins/alpha', 'alpha', '1.0.0');
    writePluginVersion(dirB, './plugins/beta', 'beta', '2.0.0');

    assert.equal(computeDirectoryFingerprint(dirA), computeDirectoryFingerprint(dirB));
  } finally {
    cleanup(dirA);
    cleanup(dirB);
  }
});

test('computeDirectoryFingerprint: does not throw when a plugin.json is missing, and differs from the fingerprint when it is present', () => {
  dir = makeFixtureDir();
  try {
    writeMarketplace(dir, [{ name: 'alpha', source: './plugins/alpha' }]);
    // No plugin.json written for alpha: readPluginVersion must fall back to 'unknown'.
    const missing = computeDirectoryFingerprint(dir);
    assert.match(missing, /^[0-9a-f]{40}$/);

    writePluginVersion(dir, './plugins/alpha', 'alpha', '1.0.0');
    const present = computeDirectoryFingerprint(dir);

    assert.notEqual(missing, present);
  } finally {
    cleanup(dir);
  }
});

test('computeDirectoryFingerprint: returns null when marketplace.json is missing', () => {
  dir = makeFixtureDir();
  try {
    assert.equal(computeDirectoryFingerprint(dir), null);
  } finally {
    cleanup(dir);
  }
});

test('computeDirectoryFingerprint: returns null when marketplace.json is not valid JSON', () => {
  dir = makeFixtureDir();
  try {
    const manifestDir = path.join(dir, '.claude-plugin');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, 'marketplace.json'), '{ not valid json');
    assert.equal(computeDirectoryFingerprint(dir), null);
  } finally {
    cleanup(dir);
  }
});
