// Drift guard for the helpers that are deliberately vendored into every pack.
//
//   node --test tests/hook-helpers-consistent.test.mjs
//
// This repo ships each plugin as an independently installable directory
// (marketplace.json gives every pack its own `source`), so a shared module
// under plugins/_shared would simply not be there after `claude plugin add
// dev-agents`, and scripts/validate.mjs would reject the unlisted directory
// on top of that. The helpers are therefore copied on purpose, and this test
// is what stops the copies from drifting apart.
//
// To add a helper: wrap it in the marker pair in every script that has it,
// then add an entry to HELPER_OWNERS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Which scripts must carry which helper. A file listed here and missing the
// block is a failure; so is a file carrying a block nobody registered.
export const HELPER_OWNERS = {
  quiet: [
    'plugins/dev-agents/scripts/require-task-plan.mjs',
    'plugins/dev-agents/scripts/track-task-plan.mjs',
    'plugins/dev-agents/scripts/check-subagent-return.mjs',
    'plugins/dev-agents/scripts/nudge-subagent-delegation.mjs',
    'plugins/dev-agents/scripts/nudge-content-fetch.mjs',
    'plugins/dev-agents/scripts/gate-last-resort.mjs',
    'plugins/context-trim/scripts/truncate-verbose-output.mjs',
    'plugins/context-trim/scripts/measure-subagent.mjs',
    'plugins/rtk/scripts/rtk-rewrite.mjs',
  ],
  readStdin: [
    'plugins/dev-agents/scripts/require-task-plan.mjs',
    'plugins/dev-agents/scripts/track-task-plan.mjs',
    'plugins/dev-agents/scripts/check-subagent-return.mjs',
    'plugins/dev-agents/scripts/nudge-subagent-delegation.mjs',
    'plugins/dev-agents/scripts/nudge-content-fetch.mjs',
    'plugins/dev-agents/scripts/gate-last-resort.mjs',
    'plugins/context-trim/scripts/truncate-verbose-output.mjs',
    'plugins/context-trim/scripts/measure-subagent.mjs',
    'plugins/claude-kit-meta/scripts/check-daily-update.mjs',
    'plugins/rtk/scripts/rtk-rewrite.mjs',
  ],
};

// Returns the marker block including both marker lines, or null when absent.
// Deliberately string-based, not regex-based: the block contains regex-hostile
// characters and a literal search cannot misfire on them.
export function extractMarkerBlock(text, name) {
  const open = `// --- shared:${name} ---`;
  const close = `// --- /shared:${name} ---`;
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(close, start);
  if (end === -1) return null;
  return text.slice(start, end + close.length);
}

// Line endings are normalized before comparison. .gitattributes may hand a
// checkout CRLF on Windows, and that is not drift.
const normalize = (s) => s.replace(/\r\n/g, '\n');

for (const [name, owners] of Object.entries(HELPER_OWNERS)) {
  test(`shared:${name} is present in every registered script`, () => {
    for (const relPath of owners) {
      const text = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
      assert.ok(
        extractMarkerBlock(text, name),
        `${relPath} is registered as carrying shared:${name} but has no marker block`
      );
    }
  });

  test(`shared:${name} is byte-identical across every copy`, () => {
    const reference = normalize(
      extractMarkerBlock(fs.readFileSync(path.join(ROOT, owners[0]), 'utf8'), name)
    );
    for (const relPath of owners.slice(1)) {
      const block = normalize(
        extractMarkerBlock(fs.readFileSync(path.join(ROOT, relPath), 'utf8'), name)
      );
      assert.equal(
        block,
        reference,
        `shared:${name} in ${relPath} differs from ${owners[0]}. Copy the reference verbatim; do not "improve" one copy.`
      );
    }
  });
}

test('no script carries an unregistered shared: block', () => {
  const registered = new Set(Object.keys(HELPER_OWNERS));
  const scripts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.mjs')) scripts.push(p);
    }
  };
  walk(path.join(ROOT, 'plugins'));
  for (const file of scripts) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\/\/ --- shared:([a-zA-Z][a-zA-Z0-9]*) ---/g)) {
      assert.ok(
        registered.has(m[1]),
        `${path.relative(ROOT, file)} declares shared:${m[1]} which is not in HELPER_OWNERS`
      );
    }
  }
});

test('every registered owner path actually exists', () => {
  for (const [name, owners] of Object.entries(HELPER_OWNERS)) {
    for (const relPath of owners) {
      assert.ok(
        fs.existsSync(path.join(ROOT, relPath)),
        `HELPER_OWNERS.${name} lists ${relPath} which does not exist; a rename left the registry stale`
      );
    }
  }
});
