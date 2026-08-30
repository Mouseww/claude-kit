// Behavioural checks for the rtk PreToolUse wrapper. rtk itself is NOT
// installed in CI (ubuntu-latest or windows-latest), so every test here
// drives the wrapper as a real child process under a controlled PATH/env
// that guarantees rtk cannot be found, and asserts the wrapper degrades to
// "run the command unchanged" rather than blocking it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'rtk-rewrite.mjs');

// A minimal but well-formed PreToolUse payload, matching what Claude Code
// actually sends for a Bash tool call.
const SAMPLE_PAYLOAD = JSON.stringify({
  session_id: 'test-session',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
});

// Runs the wrapper with the given stdin and env, returning stdout/stderr/exit
// code. `env` fully replaces process.env for the child so tests can control
// exactly what PATH (and PATHEXT on Windows) the wrapper sees.
function runWrapper(stdin, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

// A PATH that cannot possibly resolve `rtk`/`rtk.exe`: no directories at all.
// Also strips PATHEXT so the Windows extension-scan loop has nothing to
// iterate over other than the default fallback.
function envWithoutRtk(extra) {
  return {
    ...process.env,
    PATH: '',
    Path: '',
    PATHEXT: '.EXE',
    ...extra,
  };
}

test('the CLAUDE_KIT_RTK_OFF escape hatch produces empty stdout and exit 0, since it must work even if rtk is broken', async () => {
  const result = await runWrapper(SAMPLE_PAYLOAD, envWithoutRtk({ CLAUDE_KIT_RTK_OFF: '1' }));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('a missing rtk binary passes the command through instead of blocking it', async () => {
  const result = await runWrapper(SAMPLE_PAYLOAD, envWithoutRtk());
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('a missing rtk binary stays silent on stderr too, so enabling the plugin without installing rtk does not spam every Bash call', async () => {
  const result = await runWrapper(SAMPLE_PAYLOAD, envWithoutRtk());
  assert.equal(result.stderr, '');
});

test('malformed non-JSON stdin never crashes the wrapper or exits non-zero', async () => {
  const result = await runWrapper('this is not json {{{', envWithoutRtk());
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('empty stdin never crashes the wrapper or exits non-zero', async () => {
  const result = await runWrapper('', envWithoutRtk());
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
});

test('none of the fail-open paths ever emit a deny decision of their own', async () => {
  const cases = [
    await runWrapper(SAMPLE_PAYLOAD, envWithoutRtk({ CLAUDE_KIT_RTK_OFF: '1' })),
    await runWrapper(SAMPLE_PAYLOAD, envWithoutRtk()),
    await runWrapper('not json', envWithoutRtk()),
    await runWrapper('', envWithoutRtk()),
  ];
  for (const result of cases) {
    assert.ok(!result.stdout.includes('"permissionDecision":"deny"'));
    assert.ok(!result.stdout.includes('"permissionDecision": "deny"'));
  }
});
