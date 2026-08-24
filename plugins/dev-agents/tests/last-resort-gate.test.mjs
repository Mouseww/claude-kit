// Tests for gate-last-resort.mjs, the PreToolUse reminder that fires when
// dev-agents:last-resort is dispatched.
//
//   node --test plugins/dev-agents/tests/last-resort-gate.test.mjs
//
// The hook keeps no state, so there is nothing to clean up between tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, '..', 'scripts', 'gate-last-resort.mjs');

function run(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const p = spawnSync(process.execPath, [GATE], { input, encoding: 'utf8' });
  assert.equal(p.status, 0, `gate-last-resort exited ${p.status}: ${p.stderr}`);
  const out = (p.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

test('non-Agent tool_name stays silent', () => {
  assert.equal(run({ tool_name: 'Bash', tool_input: { subagent_type: 'dev-agents:last-resort' } }), null);
});

test('a different subagent stays silent', () => {
  assert.equal(
    run({ tool_name: 'Agent', tool_input: { subagent_type: 'dev-agents:quick-read' } }),
    null
  );
});

test('the namespaced last-resort id emits the message', () => {
  const out = run({ tool_name: 'Agent', tool_input: { subagent_type: 'dev-agents:last-resort' } });
  assert.ok(out, 'expected the last-resort reminder');
  const msg = out.hookSpecificOutput.additionalContext;
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(msg, /fable tier/);
  assert.match(msg, /\(1\)/);
  assert.match(msg, /\(2\)/);
  assert.match(msg, /\(3\)/);
  assert.match(msg, /\(4\)/);
});

test('the bare last-resort id emits the message', () => {
  const out = run({ tool_name: 'Agent', tool_input: { subagent_type: 'last-resort' } });
  assert.ok(out, 'expected the last-resort reminder for the bare id');
});

test('mixed-case id emits the message', () => {
  const out = run({ tool_name: 'Agent', tool_input: { subagent_type: 'Dev-Agents:Last-Resort' } });
  assert.ok(out, 'expected the last-resort reminder for the mixed-case id');
});

test('agent_type set means nested delegation, stays silent', () => {
  const out = run({
    tool_name: 'Agent',
    agent_type: 'quick-io',
    tool_input: { subagent_type: 'dev-agents:last-resort' },
  });
  assert.equal(out, null);
});

test('two identical calls in a row both emit the message', () => {
  const payload = { tool_name: 'Agent', tool_input: { subagent_type: 'dev-agents:last-resort' } };
  const first = run(payload);
  const second = run(payload);
  assert.ok(first, 'expected the first call to emit the message');
  assert.ok(second, 'expected the second call to also emit the message, unthrottled');
});

test('missing tool_input stays silent', () => {
  assert.equal(run({ tool_name: 'Agent' }), null);
});

test('malformed stdin is ignored', () => {
  const p = spawnSync(process.execPath, [GATE], { input: 'not json', encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.equal((p.stdout || '').trim(), '');
});
