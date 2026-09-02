// Tests for scripts/validate.mjs's SKILL.md `skills:` resolution check.
//
//   node --test "tests/*.test.mjs"
//
// validate.mjs derives its ROOT from its own file location
// (path.dirname(fileURLToPath(import.meta.url))), not from cwd, and it calls
// report() and exits at module scope, so it cannot be imported directly (see
// tests/sync-claude-md.test.mjs's header comment for the sibling case). To
// point it at a throwaway fixture tree instead of this repository's real
// plugins/, each test copies validate.mjs and its helper module into a temp
// scripts/ directory and builds a minimal marketplace + plugin tree next to
// it, then runs the copy as a subprocess.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_VALIDATE = path.join(REPO, 'scripts', 'validate.mjs');
const REAL_HELPERS = path.join(REPO, 'scripts', 'agent-nesting-rules.mjs');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-validate-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(REAL_VALIDATE, path.join(dir, 'scripts', 'validate.mjs'));
  fs.copyFileSync(REAL_HELPERS, path.join(dir, 'scripts', 'agent-nesting-rules.mjs'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeMarketplace() {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(
      {
        name: 'fixture-marketplace',
        owner: 'fixture',
        plugins: [{ name: 'test-pack', description: 'a fixture plugin for validate.mjs tests', source: './plugins/test-pack' }],
      },
      null,
      2
    )
  );
}

function writePlugin() {
  const pluginDir = path.join(dir, 'plugins', 'test-pack');
  fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: 'test-pack',
        description: 'a fixture plugin for validate.mjs tests, long enough to clear the forty character minimum',
        version: '0.0.1',
        license: 'MIT',
      },
      null,
      2
    )
  );
  return pluginDir;
}

function writeSkill(pluginDir, name, frontmatterExtra) {
  const skillDir = path.join(pluginDir, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  const body = [
    '---',
    `name: ${name}`,
    'description: a fixture skill long enough to clear the forty character minimum',
    ...frontmatterExtra,
    '---',
    '',
    'Fixture body.',
  ].join('\n');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), body);
}

function run() {
  const p = spawnSync(process.execPath, [path.join(dir, 'scripts', 'validate.mjs')], { encoding: 'utf8', cwd: dir });
  return { status: p.status, out: p.stdout || '' };
}

test('a SKILL.md skills: entry that resolves to a sibling skill produces no error', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  writeSkill(pluginDir, 'skill-target', []);
  writeSkill(pluginDir, 'skill-resolves', ['skills:', '  - skill-target']);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.includes('skill-resolves'), false);
});

test('a SKILL.md skills: entry using the plugin:skill form resolves the same way', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  writeSkill(pluginDir, 'skill-target', []);
  writeSkill(pluginDir, 'skill-qualified', ['skills:', '  - test-pack:skill-target']);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.includes('skill-qualified'), false);
});

test('a SKILL.md skills: entry that does not resolve is reported as an error', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  writeSkill(pluginDir, 'skill-broken', ['skills:', '  - nonexistent-skill']);
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /skill-broken\/SKILL\.md: declares skill "nonexistent-skill"/);
});

test('a SKILL.md with no skills: key at all does not crash and is not reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  writeSkill(pluginDir, 'skill-none', []);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.includes('skill-none'), false);
});

test('a SKILL.md with a malformed (non-list) skills: value does not crash and is not reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  writeSkill(pluginDir, 'skill-malformed', ['skills: not-a-list']);
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out.includes('skill-malformed'), false);
});

test('a plugin.json with a non-semver version is reported', () => {
  writeMarketplace();
  const pluginDir = path.join(dir, 'plugins', 'test-pack');
  fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'test-pack',
      version: '1.2',
      description: 'x'.repeat(50),
      license: 'MIT',
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /version "1\.2" is not/);
});

test('a hooks.json timeout above the ceiling is reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Agent', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"', timeout: 9999 }] },
        ],
      },
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /timeout 9999/);
});

test('a hook command that does not start with node is reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command', command: 'python x.py' }] }],
      },
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /does not start with "node"/);
});

test('a plugin.json with no "license" is reported', () => {
  writeMarketplace();
  const pluginDir = path.join(dir, 'plugins', 'test-pack');
  fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'test-pack',
      version: '1.0.0',
      description: 'x'.repeat(50),
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /missing "license"/);
});

test('a plugin.json with a 39-char description is reported', () => {
  writeMarketplace();
  const pluginDir = path.join(dir, 'plugins', 'test-pack');
  fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'test-pack',
      version: '1.0.0',
      description: 'x'.repeat(39),
      license: 'MIT',
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /"description" is 39 chars/);
});

test('a hook item with a non-"command" type is reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Agent', hooks: [{ type: 'cmd', command: 'node x.mjs' }] }],
      },
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /has type "cmd"; only "command" is supported/);
});

test('a hook item with no "command" is reported', () => {
  writeMarketplace();
  const pluginDir = writePlugin();
  fs.mkdirSync(path.join(pluginDir, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Agent', hooks: [{ type: 'command' }] }],
      },
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /has no "command" string/);
});

test('a plugin.json "hooks" key set to a number is reported, not thrown', () => {
  writeMarketplace();
  const pluginDir = path.join(dir, 'plugins', 'test-pack');
  fs.mkdirSync(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'test-pack',
      version: '1.0.0',
      description: 'x'.repeat(50),
      license: 'MIT',
      hooks: 5,
    })
  );
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /"hooks" must be a string or an array of strings/);
  assert.match(r.out, /FAIL:/);
});
