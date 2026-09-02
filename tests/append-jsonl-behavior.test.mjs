// Behavioural unit tests for the shared:appendJsonl helper.
//
//   node --test tests/append-jsonl-behavior.test.mjs
//
// Same approach as atomic-write-behavior.test.mjs: pull the block's source out
// of one of its owning scripts via extractMarkerBlock and drive it with
// hand-written fs/path/quiet doubles, rather than touching the real
// filesystem or importing a hook script as a module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkerBlock, HELPER_OWNERS } from './hook-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Any owner works; the drift test guarantees both are byte-identical.
const SOURCE_FILE = HELPER_OWNERS.appendJsonl[0];
const rawBlock = extractMarkerBlock(
  fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8'),
  'appendJsonl'
);
assert.ok(rawBlock, `could not extract shared:appendJsonl from ${SOURCE_FILE}`);

// Strip the two marker comment lines; what remains is the const + function.
const blockLines = rawBlock.split('\n');
const blockSource = blockLines.slice(1, -1).join('\n');

// quiet's real implementation (try/return undefined on throw); appendJsonl
// depends on it, and pulling in the real shared:quiet block would couple this
// test to a second marker block for no benefit.
function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function makeAppendJsonl(fsDouble, pathDouble) {
  const factory = new Function(
    'fs',
    'path',
    'quiet',
    `${blockSource}\nreturn appendJsonl;`
  );
  return factory(fsDouble, pathDouble, quiet);
}

test('a record within the cap is appended as itself and returns true', () => {
  const calls = [];
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    appendFileSync: (...args) => calls.push(['appendFileSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const appendJsonl = makeAppendJsonl(fsDouble, pathDouble);

  const record = { event: 'stop', agent: 'dev-agents:quick-read', session: 's1' };
  const result = appendJsonl('/log/metrics.jsonl', record);

  assert.equal(result, true);
  const writeCall = calls.find((c) => c[0] === 'appendFileSync');
  assert.ok(writeCall, 'expected an appendFileSync call');
  assert.equal(writeCall[1], '/log/metrics.jsonl');
  assert.deepEqual(JSON.parse(writeCall[2]), record);
});

// This is the assertion that would have caught the silent-loss bug: an
// oversized record above JSONL_MAX_BYTES must land on disk as a small marker
// carrying oversized:true and an orig_bytes greater than the cap, and must
// NOT be the original record (which would have exceeded PIPE_BUF and risked
// interleaving with another process's append).
test('a record above the cap is written as a marker, not as itself, and returns false', () => {
  const calls = [];
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    appendFileSync: (...args) => calls.push(['appendFileSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const appendJsonl = makeAppendJsonl(fsDouble, pathDouble);

  const bigUsage = { agentId: 'a1', blob: 'x'.repeat(5000) };
  const record = { event: 'agent_usage', session: 's1', usage: bigUsage };
  const result = appendJsonl('/log/metrics.jsonl', record);

  assert.equal(result, false);
  const writeCall = calls.find((c) => c[0] === 'appendFileSync');
  assert.ok(writeCall, 'expected an appendFileSync call for the marker');
  const written = JSON.parse(writeCall[2]);

  assert.equal(written.oversized, true);
  assert.ok(written.orig_bytes > 4000, `expected orig_bytes above the 4000-byte cap, got ${written.orig_bytes}`);
  assert.equal(written.event, 'agent_usage');
  assert.equal(written.session, 's1');
  assert.equal('usage' in written, false, 'the marker must not carry the oversized field through');
  assert.notDeepEqual(written, record);
});

test('a record exactly at the cap is written as itself', () => {
  const calls = [];
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    appendFileSync: (...args) => calls.push(['appendFileSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const appendJsonl = makeAppendJsonl(fsDouble, pathDouble);

  // Build a record whose JSON.stringify(record) + '\n' is exactly 4000 bytes.
  const base = { event: 'x', pad: '' };
  const overhead = Buffer.byteLength(JSON.stringify(base) + '\n', 'utf8');
  base.pad = 'a'.repeat(4000 - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(base) + '\n', 'utf8'), 4000);

  const result = appendJsonl('/log/metrics.jsonl', base);

  assert.equal(result, true);
  const writeCall = calls.find((c) => c[0] === 'appendFileSync');
  assert.deepEqual(JSON.parse(writeCall[2]), base);
});

test('appendJsonl never throws even when every fs call fails', () => {
  const fsDouble = {
    mkdirSync: () => {
      throw new Error('EACCES');
    },
    appendFileSync: () => {
      throw new Error('EACCES');
    },
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const appendJsonl = makeAppendJsonl(fsDouble, pathDouble);

  let threw = false;
  let result;
  try {
    result = appendJsonl('/log/metrics.jsonl', { event: 'stop' });
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'appendJsonl must never throw: every caller is a hook that must exit 0');
  assert.equal(result, false);
});
