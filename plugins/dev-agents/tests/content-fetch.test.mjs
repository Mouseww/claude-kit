// Tests for nudge-content-fetch.mjs (PreToolUse, matcher Bash|PowerShell).
//
//   node --test plugins/dev-agents/tests/content-fetch.test.mjs
//
// Dedup state lives in flag files in the OS temp dir, keyed by session id and
// category. Each test uses its own session id and cleans up after itself.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'nudge-content-fetch.mjs');
const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

const CATEGORY_KEYS = ['read-file', 'search', 'list-files', 'web-fetch', 'git-content', 'log-query'];

const sessions = new Set();
let counter = 0;
function newSession(label) {
  const id = `test-cf-${label}-${process.pid}-${counter++}`;
  sessions.add(id);
  return id;
}

afterEach(() => {
  for (const id of sessions) {
    for (const key of CATEGORY_KEYS) {
      try {
        fs.unlinkSync(path.join(STATE_DIR, `content-fetch-warned-${key}-${id}.flag`));
      } catch {
        /* already gone */
      }
    }
  }
  sessions.clear();
});

function run(command, session) {
  const p = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', session_id: session, tool_input: { command } }),
    encoding: 'utf8',
  });
  assert.equal(p.status, 0, `script exited ${p.status}: ${p.stderr}`);
  const out = (p.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

function context(out) {
  return out ? out.hookSpecificOutput.additionalContext : null;
}

// ---- one hit per category ---------------------------------------------------

test('read-file: cat on a file gets the tool-precedence reminder', () => {
  const s = newSession('read-file');
  const out = run('cat build.log', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /Read tool/);
  assert.match(ctx, /cat/);
});

test('search: grep run directly on a file gets the tool-precedence reminder', () => {
  const s = newSession('search');
  const out = run('grep TODO src/app.ts', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /Grep tool/);
});

test('list-files: find gets the tool-precedence reminder', () => {
  const s = newSession('list-files');
  const out = run('find . -name "*.ts"', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /Glob tool/);
});

test('web-fetch: curl gets the tool-precedence reminder', () => {
  const s = newSession('web-fetch');
  const out = run('curl https://example.com/api/data', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /WebFetch tool/);
});

test('git-content: plain git diff gets the narrow-at-source reminder', () => {
  const s = newSession('git-content');
  const out = run('git diff', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /narrow it at the source/);
  assert.doesNotMatch(ctx, /instead of running it through the shell/);
});

test('log-query: docker logs gets the narrow-at-source reminder', () => {
  const s = newSession('log-query');
  const out = run('docker logs myservice', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.match(ctx, /narrow it at the source/);
});

// ---- exemptions --------------------------------------------------------------

test('exempt: piped into head narrows the output', () => {
  const s = newSession('exempt-pipe-head');
  assert.equal(run('cat build.log | head -50', s), null);
});

test('exempt: output redirected to a file', () => {
  const s = newSession('exempt-redirect');
  assert.equal(run('curl https://example.com/data.json > data.json', s), null);
});

test('exempt: heredoc is a write, not a read', () => {
  const s = newSession('exempt-heredoc');
  assert.equal(run("cat <<EOF > notes.txt\nhello\nEOF", s), null);
});

test('exempt: command already carries a narrowing flag', () => {
  const s = newSession('exempt-flag');
  assert.equal(run('tail -n 20 build.log', s), null);
});

test('exempt: git diff already narrowed with --stat', () => {
  const s = newSession('exempt-git-stat');
  assert.equal(run('git diff --stat', s), null);
});

test('exempt: grep with -q only checks existence', () => {
  const s = newSession('exempt-grep-q');
  assert.equal(run('grep -q TODO src/app.ts', s), null);
});

test('psql -c without LIMIT is not swallowed by the grep -c exemption', () => {
  const s = newSession('psql-no-limit');
  const out = run('psql -c "select * from big_table"', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder: psql -c has its own -c, unrelated to grep -c');
  assert.match(ctx, /narrow it at the source/);
});

test('psql -c with LIMIT is exempt', () => {
  const s = newSession('psql-limit');
  assert.equal(run('psql -c "select * from big_table LIMIT 10"', s), null);
});

// ---- dedup and combined hits -------------------------------------------------

test('fires once per category per session', () => {
  const s = newSession('dedup');
  const first = run('cat build.log', s);
  assert.ok(context(first));
  const second = run('cat other.log', s);
  assert.equal(second, null);
});

test('a command matching two categories concatenates both reminders', () => {
  const s = newSession('combined');
  // `;` does not end the first-pipeline-segment scan (only `|` does), so both
  // detectors see the whole string and both the read-file and search triggers
  // match within it.
  const out = run('cat foo.txt; grep bar baz.txt', s);
  const ctx = context(out);
  assert.ok(ctx, 'expected a reminder');
  assert.equal(ctx.split('\n\n').length, 2);
  assert.match(ctx, /Read tool/);
  assert.match(ctx, /Grep tool/);
});

test('a single-category command produces exactly one reminder block', () => {
  const s = newSession('single-block');
  const out = run('git show HEAD:src/app.ts', s);
  const ctx = context(out);
  assert.ok(ctx);
  assert.equal(ctx.split('\n\n').length, 1);
});

test('ignores tools it is not registered for', () => {
  const s = newSession('other-tool');
  const p = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Read', session_id: s, tool_input: { command: 'cat build.log' } }),
    encoding: 'utf8',
  });
  assert.equal(p.status, 0);
  assert.equal((p.stdout || '').trim(), '');
});

test('unparseable stdin is ignored', () => {
  const p = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.equal((p.stdout || '').trim(), '');
});
