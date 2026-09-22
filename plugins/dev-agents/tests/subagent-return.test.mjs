// Tests for check-subagent-return.mjs, the post-return counterpart to
// require-task-plan.mjs.
//
//   node --test plugins/dev-agents/tests/subagent-return.test.mjs
//
// Flag/counter files live in the OS temp directory, so each test uses its
// own session id and cleans up after itself.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, '..', 'scripts', 'check-subagent-return.mjs');
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
    // bg-ack-*.flag is gone with the once-per-session throttle; only the
    // thin-result counter still keeps state.
    for (const f of [`thin-warned-${id}.count`]) {
      try {
        fs.unlinkSync(path.join(STATE_DIR, f));
      } catch {
        /* already gone */
      }
    }
  }
  sessions.clear();
});

function run(payload) {
  const p = spawnSync(process.execPath, [CHECK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  assert.equal(p.status, 0, `check-subagent-return exited ${p.status}: ${p.stderr}`);
  const out = (p.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

const check = (session, extra = {}) => run({ tool_name: 'Agent', session_id: session, ...extra });

test('non-Agent tool_name stays silent', () => {
  const s = newSession('other-tool');
  assert.equal(run({ tool_name: 'Bash', session_id: s, tool_response: null }), null);
});

test('agent_type set means nested delegation, stays silent', () => {
  const s = newSession('nested');
  assert.equal(
    check(s, { agent_type: 'dev-agents:quick-read', tool_response: null }),
    null
  );
});

// The acknowledgement a background dispatch actually returns, trimmed. The
// agentId is fabricated here; the surrounding wording is verbatim, and the real
// one measures 1134 characters, which is why it clears THIN_CHARS on its own.
const REAL_BG_ACK =
  'Async agent launched successfully. (This tool result is internal metadata - never quote or ' +
  'paste any part of it, including the agentId below, into a user-facing reply.)\n' +
  'agentId: 0000000000000000\n' +
  'The agent is working in the background. You will be notified automatically when it completes. ' +
  'You know nothing about its results until that notification arrives.';

test('every background dispatch gets the acknowledgement, with no throttle', () => {
  const s = newSession('bg');
  const payload = {
    tool_input: { run_in_background: true, subagent_type: 'dev-agents:quick-read' },
    tool_response: 'Dispatched.',
  };

  const first = check(s, payload);
  assert.ok(first, 'expected the background acknowledgement');
  assert.equal(first.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /acknowledgement, not the result/);

  // A parallel batch used to lose every dispatch after the first to a
  // once-per-session flag. Each one must now be flagged on its own.
  for (let i = 0; i < 3; i++) {
    const again = check(s, payload);
    assert.ok(again, `background dispatch ${i + 2} must still be flagged`);
    assert.match(again.hookSpecificOutput.additionalContext, /acknowledgement, not the result/);
  }
});

test('the acknowledgement names which dispatch it is about', () => {
  const s = newSession('bg-label');
  const out = check(s, {
    tool_input: {
      run_in_background: true,
      subagent_type: 'dev-agents:quick-read',
      description: 'Scan hooks for the flag',
    },
    tool_response: 'Dispatched.',
  });
  assert.ok(out);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /dev-agents:quick-read/);
  assert.match(ctx, /Scan hooks for the flag/);
});

test('a missing subagent_type and description still produce a usable label', () => {
  const s = newSession('bg-nolabel');
  const out = check(s, { tool_input: { run_in_background: true }, tool_response: 'Dispatched.' });
  assert.ok(out);
  assert.match(out.hookSpecificOutput.additionalContext, /That dispatch was a background dispatch/);
});

test('a background acknowledgement is caught without an explicit flag', () => {
  const s = newSession('bg-implicit');
  const out = check(s, {
    tool_input: { subagent_type: 'dev-agents:quick-read' },
    tool_response: REAL_BG_ACK,
  });
  assert.ok(out, 'expected the acknowledgement to be recognised from its text alone');
  assert.match(out.hookSpecificOutput.additionalContext, /acknowledgement, not the result/);
});

test('the real acknowledgement is not mistaken for a thin or failed return', () => {
  const s = newSession('bg-not-thin');
  const out = check(s, {
    tool_input: { run_in_background: true, subagent_type: 'dev-agents:quick-read' },
    tool_response: REAL_BG_ACK,
  });
  assert.ok(out);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /returned only/);
  assert.doesNotMatch(ctx, /That is a failure/);
});

test('null tool_response is a failure', () => {
  const s = newSession('null-response');
  const out = check(s, { tool_response: null });
  assert.ok(out, 'expected a failure reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /a null result/);
});

test('an interruption marker in the text is a failure', () => {
  const s = newSession('interrupted-text');
  const out = check(s, { tool_response: 'Tool execution was interrupted midway through the task.' });
  assert.ok(out, 'expected a failure reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /an interruption marker in the result/);
});

test('a truthy interrupted flag is a failure even with plenty of text', () => {
  const s = newSession('interrupted-flag');
  const longText = 'x'.repeat(500);
  const out = check(s, { tool_response: { interrupted: true, content: longText } });
  assert.ok(out, 'expected a failure reminder');
  assert.match(out.hookSpecificOutput.additionalContext, /the interrupted flag/);
});

test('a long, healthy string return stays silent', () => {
  const s = newSession('healthy');
  const longText = 'a'.repeat(500);
  assert.equal(check(s, { tool_response: longText }), null);
});

test('a short return triggers the thin-result reminder, throttled', () => {
  const s = newSession('thin');
  const shortText = 'x'.repeat(20);

  const first = check(s, { tool_response: shortText });
  assert.ok(first, 'expected the thin-result reminder on the first short return');
  assert.match(first.hookSpecificOutput.additionalContext, /returned only 20 characters/);

  const second = check(s, { tool_response: shortText });
  assert.equal(second, null, 'second short return should be throttled');

  const third = check(s, { tool_response: shortText });
  assert.ok(third, 'third short return should fire again per REPEAT_EVERY');
  assert.match(third.hookSpecificOutput.additionalContext, /returned only 20 characters/);
});

test('malformed stdin is ignored', () => {
  const p = spawnSync(process.execPath, [CHECK], { input: 'not json', encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.equal((p.stdout || '').trim(), '');
});
