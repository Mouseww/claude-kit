// Tests for the track-task-plan / require-task-plan hook pair.
//
//   node --test plugins/dev-agents/tests/task-plan.test.mjs
//
// The pair communicates through flag files in the OS temp directory, so each
// test uses its own session id and cleans up after itself. TMPDIR is not
// overridden: the scripts resolve os.tmpdir() at import time and the point is to
// exercise the real path they will use in production.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACK = path.join(HERE, '..', 'scripts', 'track-task-plan.mjs');
const REQUIRE = path.join(HERE, '..', 'scripts', 'require-task-plan.mjs');
const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

const sessions = new Set();
let counter = 0;
function newSession(label) {
  const id = `test-${label}-${process.pid}-${counter++}`;
  sessions.add(id);
  return id;
}

afterEach(() => {
  for (const id of sessions) {
    for (const f of [
      `has-plan-${id}.flag`,
      `nudged-${id}.count`,
      `bg-warned-${id}.flag`,
      `unbounded-warned-${id}.flag`,
    ]) {
      try {
        fs.unlinkSync(path.join(STATE_DIR, f));
      } catch {
        /* already gone */
      }
    }
  }
  sessions.clear();
});

function run(script, payload) {
  const p = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  assert.equal(p.status, 0, `${path.basename(script)} exited ${p.status}: ${p.stderr}`);
  const out = (p.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

const dispatch = (session, extra = {}) =>
  run(REQUIRE, { tool_name: 'Agent', session_id: session, ...extra });
const createPlan = (session) =>
  run(TRACK, { tool_name: 'TaskCreate', session_id: session, hook_event_name: 'PostToolUse' });
const flagFor = (session) => path.join(STATE_DIR, `has-plan-${session}.flag`);

test('reminds on the first dispatch when no plan exists', () => {
  const s = newSession('first');
  const out = dispatch(s);
  assert.ok(out, 'expected a reminder');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.additionalContext, /no task plan has been created/);
});

test('stays silent once a plan exists', () => {
  const s = newSession('has-plan');
  createPlan(s);
  assert.ok(fs.existsSync(flagFor(s)), 'track-task-plan should have written the flag');
  assert.equal(dispatch(s), null);
  assert.equal(dispatch(s), null);
});

test('throttles: fires on dispatch 1, then every 3rd', () => {
  const s = newSession('throttle');
  const fired = [];
  for (let i = 1; i <= 8; i++) if (dispatch(s)) fired.push(i);
  assert.deepEqual(fired, [1, 3, 6]);
});

test('never fires inside a subagent, and does not consume the counter', () => {
  const s = newSession('nested');
  assert.equal(dispatch(s, { agent_type: 'dev-agents:backend-dev' }), null);
  assert.equal(dispatch(s, { agent_type: 'dev-agents:quick-read' }), null);
  // The very next main-thread dispatch is still the first one that counts.
  assert.ok(dispatch(s), 'main-thread dispatch should still be reminder #1');
});

test('creating a plan resets the throttle counter', () => {
  const s = newSession('reset');
  dispatch(s); // reminder 1, counter now 1
  dispatch(s); // counter 2, silent
  createPlan(s);
  fs.unlinkSync(flagFor(s)); // simulate the plan being abandoned
  // Counter was reset, so the next dispatch is a first dispatch again.
  assert.ok(dispatch(s), 'reminder should return after the counter reset');
});

test('ignores tools it is not registered for', () => {
  const s = newSession('other-tool');
  assert.equal(run(REQUIRE, { tool_name: 'Bash', session_id: s }), null);
  run(TRACK, { tool_name: 'Bash', session_id: s });
  assert.equal(fs.existsSync(flagFor(s)), false, 'track should not flag on a non-TaskCreate tool');
});

test('sanitizes the session id instead of interpolating it into a path', () => {
  const evil = '../../escaped';
  run(TRACK, { tool_name: 'TaskCreate', session_id: evil });
  // Nothing may be written outside the state directory.
  assert.equal(fs.existsSync(path.resolve(STATE_DIR, '../../escaped')), false);
  // Every character outside [a-zA-Z0-9_-] becomes an underscore, dots included,
  // so "../../escaped" collapses to "______escaped".
  const written = path.join(STATE_DIR, 'has-plan-______escaped.flag');
  assert.ok(fs.existsSync(written), 'expected a sanitized filename inside the state dir');
  fs.unlinkSync(written);
});

test('background dispatch gets a reminder to tell the user, once per session', () => {
  const s = newSession('bg');
  createPlan(s); // isolate from the task-plan reminder
  const out = dispatch(s, { tool_input: { run_in_background: true, subagent_type: 'dev-agents:quick-read' } });
  assert.ok(out, 'expected a background-dispatch reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /running in the background/);
  // Second background dispatch in the same session: silent.
  assert.equal(dispatch(s, { tool_input: { run_in_background: true } }), null);
});

test('fleet-evaluator foreground dispatch gets the unbounded-scope reminder', () => {
  const s = newSession('fleet-evaluator');
  createPlan(s);
  const out = dispatch(s, { tool_input: { subagent_type: 'fleet-engineering:fleet-evaluator' } });
  assert.ok(out, 'expected an unbounded-scope reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /fleet-engineering:fleet-evaluator/);
  assert.match(out.hookSpecificOutput.additionalContext, /unbounded scope/);
});

test('an unbounded-scope marker in the prompt gets flagged and echoed back', () => {
  const s = newSession('unbounded-marker');
  createPlan(s);
  const out = dispatch(s, {
    tool_input: { subagent_type: 'dev-agents:quick-read', prompt: 'Please review the entire codebase for issues.' },
  });
  assert.ok(out, 'expected an unbounded-scope reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /"entire codebase"/);
});

test('a bounded foreground dispatch with an explicit file list stays silent', () => {
  const s = newSession('bounded');
  createPlan(s);
  const out = dispatch(s, {
    tool_input: {
      subagent_type: 'dev-agents:quick-read',
      prompt: 'Read src/foo.ts and src/bar.ts and summarize the exported functions.',
    },
  });
  assert.equal(out, null);
});

test('unbounded-scope reminder fires once per session even across repeated matches', () => {
  const s = newSession('unbounded-once');
  createPlan(s);
  const first = dispatch(s, { tool_input: { subagent_type: 'fleet-engineering:fleet-evaluator' } });
  assert.ok(first);
  const second = dispatch(s, { tool_input: { subagent_type: 'fleet-engineering:fleet-evaluator' } });
  assert.equal(second, null);
});

test('background reminder and unbounded reminder can both attach to the task-plan reminder', () => {
  const s = newSession('combined');
  const out = dispatch(s, {
    tool_input: { run_in_background: true, subagent_type: 'fleet-engineering:fleet-evaluator' },
  });
  assert.ok(out, 'expected at least the task-plan reminder');
  // Background dispatch: the unbounded check does not apply, only background + plan reminders.
  assert.match(out.hookSpecificOutput.additionalContext, /no task plan has been created/);
  assert.match(out.hookSpecificOutput.additionalContext, /running in the background/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /unbounded scope/);
});

test('unparseable stdin is ignored by both hooks', () => {
  for (const script of [TRACK, REQUIRE]) {
    const p = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
    assert.equal(p.status, 0);
    assert.equal((p.stdout || '').trim(), '');
  }
});
