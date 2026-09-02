// Tests for the read-pattern classifier behind the delegation nudge, plus
// end-to-end checks that drive the hook itself as a subprocess.
//
//   node --test plugins/dev-agents/tests/nudge-delegation.test.mjs
//
// classifyReadPattern is pure and covered directly above. The two spawn tests
// below cover the two halves classifyReadPattern alone cannot: extractPath
// (pulling a path out of tool_input) and the shape-to-message lookup in
// main(). Replacing the whole `advice` map with one fixed string, or making
// extractPath return undefined always, would still leave classifyReadPattern
// passing while every real hook invocation emitted the wrong wording (or the
// same wording regardless of shape) -- these two tests are what catches that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyReadPattern } from '../scripts/nudge-subagent-delegation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, '..', 'scripts', 'nudge-subagent-delegation.mjs');
const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

test('the same file read over and over is same-file', () => {
  const paths = Array.from({ length: 6 }, () => 'src/app/server.ts');
  assert.equal(classifyReadPattern(paths), 'same-file');
});

test('the same file with one stray read elsewhere is still same-file', () => {
  const paths = [...Array.from({ length: 8 }, () => 'src/a.ts'), 'src/b.ts'];
  assert.equal(classifyReadPattern(paths), 'same-file');
});

test('many files in one directory is same-dir', () => {
  const paths = ['src/api/a.ts', 'src/api/b.ts', 'src/api/c.ts', 'src/api/d.ts'];
  assert.equal(classifyReadPattern(paths), 'same-dir');
});

test('files spread across unrelated directories is scattered', () => {
  const paths = ['src/a.ts', 'docs/b.md', 'tests/c.test.ts', 'scripts/d.mjs'];
  assert.equal(classifyReadPattern(paths), 'scattered');
});

test('windows and posix separators normalize into the same directory bucket', () => {
  // Mixed on purpose. With normalization every path keys to 'src/api/', so
  // dirs.size is 1 and this is a same-dir survey. WITHOUT normalization the
  // forward-slash path keys to 'src/api/' while the backslash paths key to ''
  // (lastIndexOf('/') is -1), giving dirs.size 2 and a 'scattered' verdict.
  // An all-backslash list cannot tell those apart, because every key would be
  // '' either way.
  const paths = ['src/api/a.ts', 'src\\api\\b.ts', 'src\\api\\c.ts'];
  assert.equal(classifyReadPattern(paths), 'same-dir');
});

test('an empty or unusable list is scattered, the safest default', () => {
  assert.equal(classifyReadPattern([]), 'scattered');
  assert.equal(classifyReadPattern(null), 'scattered');
  assert.equal(classifyReadPattern([null, undefined, 42]), 'scattered');
});

// Drives the hook for real, `n` times in a row under one session, each time
// with the given tool_input. Returns the additionalContext of the last call
// (the one expected to cross the nudge threshold).
function driveReads(session, n, toolInputAt) {
  let lastContext;
  for (let i = 0; i < n; i++) {
    const p = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: 'Read',
        session_id: session,
        hook_event_name: 'PostToolUse',
        tool_input: toolInputAt(i),
      }),
      encoding: 'utf8',
    });
    assert.equal(p.status, 0, `hook exited ${p.status}: ${p.stderr}`);
    lastContext = undefined;
    if (p.stdout && p.stdout.trim()) {
      const parsed = JSON.parse(p.stdout);
      lastContext = parsed.hookSpecificOutput?.additionalContext;
    }
  }
  return lastContext;
}

test('16 reads across files in one directory trigger the same-dir wording', () => {
  const session = 'nudge-same-dir-' + process.pid;
  const safeId = session.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stateFile = path.join(STATE_DIR, `${safeId}.streak`);
  fs.rmSync(stateFile, { force: true });

  try {
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
    const context = driveReads(session, 16, (i) => ({
      file_path: `src/api/${files[i % files.length]}`,
    }));
    assert.ok(context, 'the 16th read should emit a nudge');
    assert.match(context, /That is a survey/);
  } finally {
    fs.rmSync(stateFile, { force: true });
  }
});

test('16 reads of the same file trigger the same-file wording', () => {
  const session = 'nudge-same-file-' + process.pid;
  const safeId = session.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stateFile = path.join(STATE_DIR, `${safeId}.streak`);
  fs.rmSync(stateFile, { force: true });

  try {
    const context = driveReads(session, 16, () => ({
      file_path: 'src/app/server.ts',
    }));
    assert.ok(context, 'the 16th read should emit a nudge');
    assert.match(context, /Re-reading one file/);
  } finally {
    fs.rmSync(stateFile, { force: true });
  }
});

test('a legacy MODE:COUNT streak file is still honoured, not reset', () => {
  const session = 'legacy-streak-' + process.pid;
  const safeId = session.replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, `${safeId}.streak`);
  fs.writeFileSync(stateFile, 'R:5');

  try {
    const p = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({
        tool_name: 'Read',
        session_id: session,
        hook_event_name: 'PostToolUse',
        tool_input: { file_path: 'src/app/server.ts' },
      }),
      encoding: 'utf8',
    });
    assert.equal(p.status, 0, `hook exited ${p.status}: ${p.stderr}`);

    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(saved.mode, 'R');
    assert.equal(saved.n, 6, 'a legacy R:5 file should continue the streak at 6, not reset to 1');
  } finally {
    fs.rmSync(stateFile, { force: true });
  }
});
