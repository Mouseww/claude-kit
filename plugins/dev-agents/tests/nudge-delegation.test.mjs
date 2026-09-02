// Tests for the read-pattern classifier behind the delegation nudge, plus one
// end-to-end check that a legacy `MODE:COUNT` streak file is still honoured.
//
//   node --test plugins/dev-agents/tests/nudge-delegation.test.mjs

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

test('windows and posix separators classify the same way', () => {
  assert.equal(classifyReadPattern(['src\\api\\a.ts', 'src\\api\\b.ts', 'src\\api\\c.ts']), 'same-dir');
});

test('an empty or unusable list is scattered, the safest default', () => {
  assert.equal(classifyReadPattern([]), 'scattered');
  assert.equal(classifyReadPattern(null), 'scattered');
  assert.equal(classifyReadPattern([null, undefined, 42]), 'scattered');
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
