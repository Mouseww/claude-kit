// Regression tests for scripts/truncate-verbose-output.mjs.
//
//   node --test plugins/context-trim/tests/
//
// Ported from the previous python/bash harness. The old harness diffed a new
// bash script against an old one and needed python3 + bash + a fake PATH to
// simulate a missing awk; none of that applies now that the hook is a single
// node script, so those two mechanisms are gone. Every behavioural case and
// assertion from the original is preserved.
//
// Invariants asserted on every case:
//   A. output must be at least MIN_SAVING_PCT smaller, or pass through
//   B. never emit an empty/near-empty body that would wipe the tool output
//   C. the notice text must describe the path actually taken

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'truncate-verbose-output.mjs');
const MIN_SAVING_PCT = 20;

/** Run the hook and return the raw updatedToolOutput, or null on passthrough. */
function raw(payload) {
  const p = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  const out = (p.stdout || '').trim();
  if (!out) return null;
  return JSON.parse(out).hookSpecificOutput.updatedToolOutput;
}

/** Run the hook and return the replacement text, or null on passthrough. */
function run(payload) {
  const d = raw(payload);
  if (d === null) return null;
  if (typeof d === 'object') {
    if ('stdout' in d) return d.stdout;
    if (Array.isArray(d.content)) {
      return d.content.map((b) => (b && typeof b === 'object' ? b.text || '' : '')).join('');
    }
    return '';
  }
  return d;
}

const payload = (body, tool = 'Bash') => ({
  tool_name: tool,
  session_id: 't',
  tool_response: { stdout: body, stderr: '', interrupted: false, isImage: false },
});

/** Cowork / MCP shell tools return content blocks, not stdout/stderr. */
const mcpPayload = (body) => ({
  tool_name: 'mcp__workspace__bash',
  session_id: 't',
  tool_response: { content: [{ type: 'text', text: body }], isError: false },
});

const lines = (n, w, pre = 'row') =>
  Array.from({ length: n }, (_, i) => `${pre} ${i} ` + 'z'.repeat(w)).join('\n');

const CASES = {
  '1  single 40k-char line': 'x'.repeat(40000),
  '2  50 lines x 300': lines(50, 300),
  '3  100 lines x 300': lines(100, 300),
  '4  159 lines x 300': lines(159, 300),
  '5  300 lines x 300': lines(300, 300),
  '6  200 lines x 500 long-line log': lines(200, 500, 'data'),
  '7  clean build + Found 0 errors': lines(400, 8, 'compiling module') + '\nFound 0 errors.',
  '8  200 FAILED, keep the tail':
    Array.from({ length: 200 }, (_, i) => `test_${i} FAILED reason ${i} ` + 'y'.repeat(60)).join('\n') +
    '\n\n=== 200 failed, 0 passed in 42.1s ===',
  '9  real error mid-stream':
    lines(300, 4, 'ok') +
    '\nTypeError: cannot read x of undefined\n  at foo.js:12\n' +
    lines(300, 4, 'after') +
    '\nBuild failed with 1 error',
  '10 short output, no trigger': lines(20, 4, 'tiny'),
  '11 npm warn noise': Array.from(
    { length: 300 },
    (_, i) => `npm warn deprecated pkg-${i}@1.0.0 unsupported`
  ).join('\n'),
  '12 empty output': '',
  '13 single huge line with error': 'FATAL error: ' + 'q'.repeat(40000),
  '14 failure tail 25 lines x 3000': lines(300, 20, 'boom error') + '\n' + lines(25, 3000, 'tail'),
  '15 drops below threshold after CRLF': 'a\r\n'.repeat(2300),
  '16 few but long error lines': lines(3, 2500, 'fatal error'),
  '17 20 error lines x 400': lines(20, 400, 'exception at'),
  '18 just over threshold, saving too small': 'b'.repeat(6100),
};

test('invariants hold for every case', () => {
  for (const [name, body] of Object.entries(CASES)) {
    const orig = body.length;
    const out = run(payload(body));
    if (out === null) continue; // passthrough is always acceptable

    // Invariant A: must be meaningfully smaller.
    assert.ok(out.length < orig, `${name}: GREW (${orig} -> ${out.length})`);
    const saved = 100 - Math.floor((out.length * 100) / Math.max(orig, 1));
    assert.ok(
      saved >= MIN_SAVING_PCT,
      `${name}: replaced for only ${saved}% saving (<${MIN_SAVING_PCT}%)`
    );

    // Invariant B: a non-empty body beyond the notice line.
    const rest = out.split('\n').slice(1).join('\n');
    assert.ok(rest.trim().length > 0, `${name}: body is empty`);

    // Invariant C: the notice is present and names the path.
    assert.match(out.split('\n')[0], /\[context-trim: /, `${name}: notice missing`);
  }
});

test('case 8 keeps the tail summary', () => {
  assert.match(run(payload(CASES['8  200 FAILED, keep the tail'])), /200 failed, 0 passed/);
});

test('case 7 "Found 0 errors" is not misjudged as a failure', () => {
  assert.doesNotMatch(run(payload(CASES['7  clean build + Found 0 errors'])), /looks like a failure/);
});

test('case 11 npm warn noise is not misjudged as a failure', () => {
  assert.doesNotMatch(run(payload(CASES['11 npm warn noise'])), /looks like a failure/);
});

test('case 9 real error is judged a failure and keeps both ends', () => {
  const out = run(payload(CASES['9  real error mid-stream']));
  assert.match(out, /looks like a failure/);
  assert.match(out, /TypeError/);
  assert.match(out, /Build failed/);
});

test('short and empty output pass through untouched', () => {
  assert.equal(run(payload(CASES['10 short output, no trigger'])), null);
  assert.equal(run(payload(CASES['12 empty output'])), null);
});

test('case 1 single long line falls back to character slicing', () => {
  const out = run(payload(CASES['1  single 40k-char line']));
  assert.ok(out !== null && out.length < 6000);
  assert.match(out, /character position/);
});

test('case 14 long failure tail is capped by the character limit', () => {
  const out = run(payload(CASES['14 failure tail 25 lines x 3000']));
  assert.ok(out !== null && out.length < 12000, `expected <12000, got ${out?.length}`);
});

test('case 15 drops below threshold after CRLF normalization -> passthrough', () => {
  assert.equal(run(payload(CASES['15 drops below threshold after CRLF'])), null);
});

test('case 16 notice matches the path actually taken', () => {
  const out = run(payload(CASES['16 few but long error lines']));
  if (out === null) return; // passthrough is acceptable
  const first = out.split('\n')[0];
  assert.ok(
    /character position/.test(first) || (/error context/.test(first) && /tail/.test(first)),
    `notice does not match path: ${first}`
  );
});

test('case 18 no replacement unless at least 20% is saved', () => {
  const out = run(payload(CASES['18 just over threshold, saving too small']));
  assert.ok(out === null || out.length <= 6100 * 0.8);
});

test('native shape round-trips and preserves sibling fields', () => {
  const r = raw(payload(lines(300, 300)));
  assert.ok(r && typeof r === 'object' && 'stdout' in r);
  assert.equal(r.interrupted, false);
  assert.equal(r.isImage, false);
  assert.equal(r.stderr, '');
});

test('MCP shape round-trips and preserves sibling fields', () => {
  const body = lines(300, 300);
  const r = raw(mcpPayload(body));
  assert.ok(r && Array.isArray(r.content));
  assert.equal(r.content[0].type, 'text');
  assert.equal(r.isError, false);
  const text = r.content[0].text;
  assert.ok(text.length < body.length * 0.5);
  assert.match(text, /context-trim/);
});

test('unrecognized tool_response shape passes through', () => {
  assert.equal(
    raw({ tool_name: 'Bash', session_id: 't', tool_response: { somethingElse: lines(400, 100) } }),
    null
  );
});

test('non-shell tool name passes through (guard, not just the matcher)', () => {
  assert.equal(
    raw({ tool_name: 'Read', session_id: 't', tool_response: { stdout: lines(400, 100), stderr: '' } }),
    null
  );
});

test('unparseable stdin passes through', () => {
  const p = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal((p.stdout || '').trim(), '');
  assert.equal(p.status, 0);
});
