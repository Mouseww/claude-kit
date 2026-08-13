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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'truncate-verbose-output.mjs');
const MIN_SAVING_PCT = 20;

// The hook writes telemetry to CONTEXT_TRIM_METRICS_FILE, falling back to the
// user's real ~/.claude/context-offload-metrics.jsonl if that env var is
// unset. Setting a process-wide default here means every spawnSync call in
// this file -- not just the telemetry-specific tests below -- writes to a
// scratch file instead of polluting the user's real metrics log. Individual
// tests can still override it via the `env` param to inspect what got
// written for a specific case.
const DEFAULT_METRICS_FILE = path.join(os.tmpdir(), `context-trim-test-metrics-default-${process.pid}.jsonl`);
process.env.CONTEXT_TRIM_METRICS_FILE = DEFAULT_METRICS_FILE;
process.on('exit', () => {
  try {
    fs.unlinkSync(DEFAULT_METRICS_FILE);
  } catch {
    // already absent, nothing to clean up
  }
});

/**
 * Points CONTEXT_TRIM_METRICS_FILE at a fresh per-call scratch file so a test
 * can inspect exactly what got logged, without touching the shared default
 * file above or the user's real metrics log. Removed afterwards.
 */
function withMetricsFile(fn) {
  const file = path.join(os.tmpdir(), `context-trim-test-metrics-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  try {
    return fn(file);
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      // already absent, nothing to clean up
    }
  }
}

function readTelemetry(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Run the hook and return the raw updatedToolOutput, or null on passthrough. */
function raw(payload, env = {}) {
  const p = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
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

const payload = (body, tool = 'Bash', command) => ({
  tool_name: tool,
  session_id: 't',
  ...(command !== undefined ? { tool_input: { command } } : {}),
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

// ---- followup suggestion classification ------------------------------------
// The hook is the one place that knows for certain content was just lost, so
// once it has already decided to truncate, it appends an actionable followup
// for commands that were clearly aimed at retrieving content. Everything else
// (plain build/test/install commands) must be byte-identical to before.

test('read-file command suggests the Read tool', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'cat build.log'));
  assert.match(out, /use the Read tool instead/);
});

test('search command suggests the Grep tool', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'grep -r TODO src/'));
  assert.match(out, /use the Grep tool instead/);
});

test('recursive list command suggests the Glob tool', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'ls -R src/'));
  assert.match(out, /use the Glob tool instead/);
});

test('web fetch command suggests the WebFetch tool', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'curl https://example.com/api'));
  assert.match(out, /use the WebFetch tool instead/);
});

test('git show suggests narrowing at the source, not a tool swap', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'git show HEAD'));
  assert.match(out, /Rerun narrower next time/);
  assert.match(out, /--stat|--name-only|-- <path>|-n <num>/);
  assert.doesNotMatch(out, /instead/);
});

test('kubectl logs suggests narrowing at the source, not a tool swap', () => {
  const out = run(payload(lines(400, 20), 'Bash', 'kubectl logs my-pod'));
  assert.match(out, /Rerun narrower next time/);
  assert.match(out, /--tail=N|-n N|LIMIT|jq filter/);
  assert.doesNotMatch(out, /instead/);
});

test('ordinary build command gets no suggestion, notice unchanged', () => {
  const withCommand = run(payload(lines(400, 20), 'Bash', 'npm run build'));
  const withoutCommand = run(payload(lines(400, 20)));
  assert.equal(withCommand, withoutCommand);
  assert.doesNotMatch(withCommand, /Read tool|Grep tool|Glob tool|WebFetch tool|Rerun narrower/);
});

test('small output with a retrieval-looking command still passes through untouched', () => {
  assert.equal(run(payload(CASES['10 short output, no trigger'], 'Bash', 'cat small.log')), null);
});

test('unparseable stdin passes through', () => {
  const p = spawnSync(process.execPath, [SCRIPT], { input: 'not json', encoding: 'utf8' });
  assert.equal((p.stdout || '').trim(), '');
  assert.equal(p.status, 0);
});

// ---- quantified omission markers -------------------------------------------
// Every ellipsis marker in the emitted body must carry a line/char count, so
// the model reading the notice can judge whether the loss is worth a rerun.

test('error mode: budget cut on matching lines reports a line/char count', () => {
  // 20 long "error" lines blow well past ERR_BUDGET (3000 chars), forcing the
  // matching-line loop to break early.
  const out = run(payload(CASES['17 20 error lines x 400']));
  assert.match(out, /looks like a failure/);
  assert.match(out, /\.\.\.\[\d+ lines \/ \d+ chars omitted\]\.\.\./);
  assert.doesNotMatch(out, /more matching lines omitted/);
});

test('clean mode marker is unchanged (regression)', () => {
  const out = run(payload(lines(300, 300)));
  assert.match(out, /\.\.\.\[\d+ lines \/ \d+ chars omitted\]\.\.\./);
});

// ---- telemetry ---------------------------------------------------------

test('telemetry: passthrough path is logged for small output', () => {
  withMetricsFile((metricsFile) => {
    const before = readTelemetry(metricsFile).length;
    const out = raw(payload(CASES['10 short output, no trigger']), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    assert.equal(out, null);
    const entries = readTelemetry(metricsFile).slice(before);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].event, 'truncate');
    assert.equal(entries[0].path, 'passthrough');
    assert.equal(entries[0].orig_chars, entries[0].final_chars);
    assert.equal(entries[0].err_cut, false);
    assert.equal(entries[0].tool, 'Bash');
  });
});

test('telemetry: clean path is logged with a real saving', () => {
  withMetricsFile((metricsFile) => {
    raw(payload(lines(300, 300)), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    const entries = readTelemetry(metricsFile);
    const entry = entries[entries.length - 1];
    assert.equal(entry.path, 'clean');
    assert.equal(entry.err_cut, false);
    assert.ok(entry.final_chars < entry.orig_chars);
  });
});

test('telemetry: char path is logged for the single-long-line fallback', () => {
  withMetricsFile((metricsFile) => {
    raw(payload(CASES['1  single 40k-char line']), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    const entries = readTelemetry(metricsFile);
    const entry = entries[entries.length - 1];
    assert.equal(entry.path, 'char');
  });
});

test('telemetry: error path with err_cut true when the budget is exceeded', () => {
  withMetricsFile((metricsFile) => {
    raw(payload(CASES['17 20 error lines x 400']), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    const entries = readTelemetry(metricsFile);
    const entry = entries[entries.length - 1];
    assert.equal(entry.path, 'error');
    assert.equal(entry.err_cut, true);
    assert.ok(entry.err_lines_omitted > 0);
  });
});

test('telemetry: error path with err_cut false when nothing was cut', () => {
  withMetricsFile((metricsFile) => {
    raw(payload(CASES['9  real error mid-stream']), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    const entries = readTelemetry(metricsFile);
    const entry = entries[entries.length - 1];
    assert.equal(entry.path, 'error');
    assert.equal(entry.err_cut, false);
    assert.equal(entry.err_lines_omitted, 0);
  });
});

test('telemetry: looks_structured reflects the first non-whitespace char, does not affect truncation', () => {
  withMetricsFile((metricsFile) => {
    const jsonBody = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ i, v: 'z'.repeat(20) })) });
    raw(payload(jsonBody), { CONTEXT_TRIM_METRICS_FILE: metricsFile });
    const entries = readTelemetry(metricsFile);
    const entry = entries[entries.length - 1];
    assert.equal(entry.looks_structured, true);
  });
});

test('telemetry: never breaks the hook even if the log directory cannot be created', () => {
  // Point at a path whose parent cannot exist as a directory (a file used as
  // a directory segment). The hook must still emit its normal output.
  withMetricsFile((metricsFile) => {
    fs.writeFileSync(metricsFile, 'not a directory');
    const badPath = path.join(metricsFile, 'nested', 'metrics.jsonl');
    const p = spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify(payload(lines(300, 300))),
      encoding: 'utf8',
      env: { ...process.env, CONTEXT_TRIM_METRICS_FILE: badPath },
    });
    assert.equal(p.status, 0);
    assert.ok((p.stdout || '').trim().length > 0);
  });
});
