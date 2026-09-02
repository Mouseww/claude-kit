// Behavioural unit tests for the shared:atomicWrite helper.
//
//   node --test tests/atomic-write-behavior.test.mjs
//
// The concurrency test that used to live here (spawnSync in a Promise.all)
// proved nothing: spawnSync's executor runs to completion inside the Promise
// constructor, so the eight dispatches fully serialized, and neither assertion
// could distinguish atomicWrite from a reverted bare fs.writeFileSync. This
// file replaces it with a deterministic test of the helper's actual branches,
// using extractMarkerBlock to pull the block's source out of one of its six
// owning scripts and hand-written fs/path doubles to drive each path.
//
// HELPER_OWNERS and extractMarkerBlock are imported from hook-helpers.mjs, a
// plain module with no test() calls, not from hook-helpers-consistent.test.mjs
// directly: importing a *.test.mjs file re-runs its top-level test()
// registrations in this file's process, which would double-count its tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkerBlock, HELPER_OWNERS } from './hook-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Any owner works; the drift test guarantees all six are byte-identical.
const SOURCE_FILE = HELPER_OWNERS.atomicWrite[0];
const rawBlock = extractMarkerBlock(
  fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8'),
  'atomicWrite'
);
assert.ok(rawBlock, `could not extract shared:atomicWrite from ${SOURCE_FILE}`);

// Strip the two marker comment lines; what remains is the function declaration.
const blockLines = rawBlock.split('\n');
const blockSource = blockLines.slice(1, -1).join('\n');

// Builds a fresh atomicWrite bound to the supplied fs/path doubles. A fresh
// function per test avoids any shared state between cases.
function makeAtomicWrite(fsDouble, pathDouble) {
  const factory = new Function('fs', 'path', `${blockSource}\nreturn atomicWrite;`);
  return factory(fsDouble, pathDouble);
}

// Records calls in order so assertions can check the call sequence, not real
// files. No case in this file touches the real filesystem.
function makeRecorder() {
  const calls = [];
  return { calls };
}

test('success path: writes to a .tmp name, renames over the target, returns true', () => {
  const { calls } = makeRecorder();
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    writeFileSync: (...args) => calls.push(['writeFileSync', ...args]),
    renameSync: (...args) => calls.push(['renameSync', ...args]),
    unlinkSync: (...args) => calls.push(['unlinkSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const atomicWrite = makeAtomicWrite(fsDouble, pathDouble);

  const result = atomicWrite('/state/target.flag', '1');

  assert.equal(result, true);
  const writeCall = calls.find((c) => c[0] === 'writeFileSync');
  assert.ok(writeCall, 'expected a writeFileSync call');
  const tmpPath = writeCall[1];
  // The assertion a bare fs.writeFileSync implementation fails: the write
  // target is NOT the final target path.
  assert.notEqual(tmpPath, '/state/target.flag');
  assert.match(tmpPath, /\.tmp$/);
  const renameCall = calls.find((c) => c[0] === 'renameSync');
  assert.ok(renameCall, 'expected a renameSync call');
  assert.equal(renameCall[1], tmpPath);
  assert.equal(renameCall[2], '/state/target.flag');
  // No cleanup needed on the success path.
  assert.equal(calls.some((c) => c[0] === 'unlinkSync'), false);
});

test('rename fails on all three attempts, direct write succeeds: returns true', () => {
  const { calls } = makeRecorder();
  let renameAttempts = 0;
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    writeFileSync: (dest, text) => {
      calls.push(['writeFileSync', dest, text]);
      // Direct write to the target (the fallback path) always succeeds; only
      // the tmp-then-rename attempts are made to fail via renameSync below.
    },
    renameSync: (...args) => {
      renameAttempts += 1;
      calls.push(['renameSync', ...args]);
      throw new Error('EPERM: simulated Windows lock');
    },
    unlinkSync: (...args) => calls.push(['unlinkSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const atomicWrite = makeAtomicWrite(fsDouble, pathDouble);

  const result = atomicWrite('/state/target.flag', '1');

  assert.equal(result, true);
  assert.equal(renameAttempts, 3, 'expected exactly three rename attempts');
  const writesToTarget = calls.filter((c) => c[0] === 'writeFileSync' && c[1] === '/state/target.flag');
  assert.ok(writesToTarget.length >= 1, 'expected a direct write to the target path in the fallback');
});

test('every path fails: returns false and does not throw', () => {
  const { calls } = makeRecorder();
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    writeFileSync: () => {
      throw new Error('EPERM: simulated failure everywhere');
    },
    renameSync: () => {
      throw new Error('EPERM: simulated failure everywhere');
    },
    unlinkSync: () => {
      throw new Error('ENOENT: nothing to clean up');
    },
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const atomicWrite = makeAtomicWrite(fsDouble, pathDouble);

  let threw = false;
  let result;
  try {
    result = atomicWrite('/state/target.flag', '1');
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'atomicWrite must never throw: every caller is a hook that must exit 0');
  assert.equal(result, false);
});

test('parent directory missing: mkdirSync is called with { recursive: true } before the write', () => {
  const { calls } = makeRecorder();
  const fsDouble = {
    mkdirSync: (...args) => calls.push(['mkdirSync', ...args]),
    writeFileSync: (...args) => calls.push(['writeFileSync', ...args]),
    renameSync: (...args) => calls.push(['renameSync', ...args]),
    unlinkSync: (...args) => calls.push(['unlinkSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const atomicWrite = makeAtomicWrite(fsDouble, pathDouble);

  atomicWrite('/state/nested/target.flag', '1');

  const mkdirCall = calls[0];
  assert.ok(mkdirCall, 'expected mkdirSync to be called');
  assert.equal(mkdirCall[0], 'mkdirSync');
  assert.equal(mkdirCall[1], '/state/nested');
  assert.deepEqual(mkdirCall[2], { recursive: true });
  const firstWriteIndex = calls.findIndex((c) => c[0] === 'writeFileSync');
  assert.ok(firstWriteIndex > 0, 'expected at least one write after mkdirSync');
});

test('mkdirSync throwing does not prevent the write attempt or throw out', () => {
  const { calls } = makeRecorder();
  const fsDouble = {
    mkdirSync: () => {
      throw new Error('EACCES: cannot create directory');
    },
    writeFileSync: (...args) => calls.push(['writeFileSync', ...args]),
    renameSync: (...args) => calls.push(['renameSync', ...args]),
    unlinkSync: (...args) => calls.push(['unlinkSync', ...args]),
  };
  const pathDouble = { dirname: (f) => f.split('/').slice(0, -1).join('/') || '.' };
  const atomicWrite = makeAtomicWrite(fsDouble, pathDouble);

  let threw = false;
  let result;
  try {
    result = atomicWrite('/state/target.flag', '1');
  } catch {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(result, true);
  assert.ok(calls.some((c) => c[0] === 'writeFileSync'), 'expected the write to still be attempted');
});
