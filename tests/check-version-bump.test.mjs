// Tests for the version-bump gate's decision function.
//
//   node --test tests/check-version-bump.test.mjs
//
// Only the pure decision is tested. Resolving a git base ref is I/O and is
// covered by the skip paths in the script itself, not here.
//
// One exception: a spawn test below proves the isMain guard actually fires.
// A guard that stops matching (e.g. a URL-vs-path mismatch on Windows) makes
// this script print nothing and exit 0 -- a green CI step enforcing nothing,
// in the one script whose entire value is that it fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRuntimePath, pluginOf, decide } from '../scripts/check-version-bump.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'check-version-bump.mjs');

test('running the script directly with no --base actually runs main() and prints SKIP, exit 0', () => {
  const res = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /SKIP:/);
});

test('a hook script is a runtime path', () => {
  assert.equal(isRuntimePath('plugins/dev-agents/scripts/require-task-plan.mjs'), true);
});

test('an agent, a skill, a command and a manifest are runtime paths', () => {
  assert.equal(isRuntimePath('plugins/dev-agents/agents/deepthink.md'), true);
  assert.equal(isRuntimePath('plugins/dev-agents/skills/dev-agents/SKILL.md'), true);
  assert.equal(isRuntimePath('plugins/rtk/commands/setup.md'), true);
  assert.equal(isRuntimePath('plugins/rtk/.claude-plugin/plugin.json'), true);
  assert.equal(isRuntimePath('plugins/code-graph/.mcp.json'), true);
  assert.equal(isRuntimePath('plugins/dev-agents/claude-md-block.md'), true);
});

test('a README and a test are not runtime paths', () => {
  assert.equal(isRuntimePath('plugins/dev-agents/README.md'), false);
  assert.equal(isRuntimePath('plugins/dev-agents/tests/task-plan.test.mjs'), false);
});

test('a path outside plugins is not a runtime path', () => {
  assert.equal(isRuntimePath('scripts/validate.mjs'), false);
  assert.equal(isRuntimePath('AGENTS.md'), false);
});

test('pluginOf extracts the pack name, and null outside plugins', () => {
  assert.equal(pluginOf('plugins/rtk/scripts/rtk-rewrite.mjs'), 'rtk');
  assert.equal(pluginOf('scripts/validate.mjs'), null);
  assert.equal(pluginOf('plugins'), null);
});

test('a runtime change with no version bump is a violation', () => {
  const { violations } = decide(
    ['plugins/dev-agents/scripts/require-task-plan.mjs'],
    { 'dev-agents': '1.8.0' },
    { 'dev-agents': '1.8.0' }
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].plugin, 'dev-agents');
});

test('a runtime change with a version bump passes', () => {
  const { violations } = decide(
    ['plugins/dev-agents/scripts/require-task-plan.mjs'],
    { 'dev-agents': '1.8.0' },
    { 'dev-agents': '1.9.0' }
  );
  assert.deepEqual(violations, []);
});

test('a doc-only change needs no bump', () => {
  const { violations } = decide(
    ['plugins/dev-agents/README.md', 'plugins/dev-agents/tests/task-plan.test.mjs'],
    { 'dev-agents': '1.8.0' },
    { 'dev-agents': '1.8.0' }
  );
  assert.deepEqual(violations, []);
});

test('a brand new plugin is not a violation even though it has no previous version', () => {
  const { violations } = decide(
    ['plugins/newpack/scripts/x.mjs'],
    {},
    { newpack: '1.0.0' }
  );
  assert.deepEqual(violations, []);
});

test('a deleted plugin is not a violation', () => {
  const { violations } = decide(
    ['plugins/gonepack/scripts/x.mjs'],
    { gonepack: '1.0.0' },
    {}
  );
  assert.deepEqual(violations, []);
});

test('several plugins are reported independently', () => {
  const { violations } = decide(
    ['plugins/dev-agents/scripts/a.mjs', 'plugins/rtk/scripts/b.mjs'],
    { 'dev-agents': '1.8.0', rtk: '1.0.0' },
    { 'dev-agents': '1.9.0', rtk: '1.0.0' }
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].plugin, 'rtk');
});

test('an equal version is still a violation', () => {
  const { violations } = decide(
    ['plugins/dev-agents/scripts/require-task-plan.mjs'],
    { 'dev-agents': '1.8.0' },
    { 'dev-agents': '1.8.0' }
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /stayed at 1\.8\.0/);
});

test('a downgrade is a violation, not a pass', () => {
  const { violations } = decide(
    ['plugins/dev-agents/scripts/require-task-plan.mjs'],
    { 'dev-agents': '1.9.0' },
    { 'dev-agents': '1.8.0' }
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].plugin, 'dev-agents');
  assert.match(violations[0].reason, /backwards, from 1\.9\.0 to 1\.8\.0/);
});

test('checked lists every plugin the gate actually considered', () => {
  const { checked } = decide(
    ['plugins/dev-agents/scripts/a.mjs', 'plugins/dev-agents/README.md', 'plugins/rtk/scripts/b.mjs'],
    { 'dev-agents': '1.8.0', rtk: '1.0.0' },
    { 'dev-agents': '1.9.0', rtk: '1.1.0' }
  );
  assert.deepEqual(checked.sort(), ['dev-agents', 'rtk']);
});
