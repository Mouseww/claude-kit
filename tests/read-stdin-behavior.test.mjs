// Behavioural unit tests for the shared:readStdin helper.
//
//   node --test tests/read-stdin-behavior.test.mjs
//
// Ten copies of readStdin exist, and the only test feeding it before this
// file went through spawnSync({ input }), which closes stdin so 'end' fires
// on every run. That path never exercises the idle timer or the absolute
// deadline: the idle timer could be deleted from all ten copies and the
// suite would stay green. This file follows the pattern in
// atomic-write-behavior.test.mjs: extract the block's source with
// extractMarkerBlock and instantiate it with `new Function` against injected
// fake `process`/`setTimeout`/`clearTimeout`, driven deterministically with
// no wall-clock waiting.
//
// HELPER_OWNERS and extractMarkerBlock are imported from hook-helpers.mjs, a
// plain module with no test() calls, not from hook-helpers-consistent.test.mjs
// directly, for the same reason atomic-write-behavior.test.mjs does: importing
// a *.test.mjs file re-runs its top-level test() registrations in this
// file's process, which would double-count its tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMarkerBlock, HELPER_OWNERS } from './hook-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Any owner works; the drift test guarantees all copies are byte-identical.
const SOURCE_FILE = HELPER_OWNERS.readStdin[0];
const rawBlock = extractMarkerBlock(
  fs.readFileSync(path.join(ROOT, SOURCE_FILE), 'utf8'),
  'readStdin'
);
assert.ok(rawBlock, `could not extract shared:readStdin from ${SOURCE_FILE}`);

// Strip the two marker comment lines; what remains is the function declaration.
const blockLines = rawBlock.split('\n');
const blockSource = blockLines.slice(1, -1).join('\n');

// Builds a fresh readStdin bound to the supplied process/setTimeout/clearTimeout
// doubles. A fresh function per test avoids any shared state between cases.
function makeReadStdin(processDouble, setTimeoutDouble, clearTimeoutDouble) {
  const factory = new Function(
    'process',
    'setTimeout',
    'clearTimeout',
    `${blockSource}\nreturn readStdin;`
  );
  return factory(processDouble, setTimeoutDouble, clearTimeoutDouble);
}

// A deterministic fake timer queue. Timers are identified by delay so a test
// can fire "the idle one" or "the absolute one" without tracking opaque ids,
// as long as idleMs and absoluteMs are chosen distinct in each test.
function makeFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  function setTimeoutFake(cb, delay) {
    const id = nextId++;
    const handle = { id, unref() {} };
    timers.set(id, { cb, delay });
    return handle;
  }
  function clearTimeoutFake(handle) {
    if (handle && timers.has(handle.id)) timers.delete(handle.id);
  }
  function fireByDelay(delay) {
    let target = null;
    for (const [id, t] of timers) {
      if (t.delay === delay) target = id;
    }
    if (target == null) throw new Error(`no pending fake timer with delay ${delay}`);
    const t = timers.get(target);
    timers.delete(target);
    t.cb();
  }
  return { setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake, timers, fireByDelay };
}

// A minimal fake stdin: enough of the EventEmitter surface for the block
// (setEncoding, on, removeAllListeners, pause) with no real stream behind it.
function makeFakeStdin() {
  const listeners = { data: [], end: [], error: [] };
  return {
    setEncoding() {},
    on(event, cb) {
      listeners[event].push(cb);
    },
    removeAllListeners(event) {
      listeners[event] = [];
    },
    pause() {},
    emit(event, ...args) {
      for (const cb of listeners[event].slice()) cb(...args);
    },
    listenerCount(event) {
      return listeners[event].length;
    },
  };
}

test('resolves on end with whatever data arrived, and clears both timers', async () => {
  const timers = makeFakeTimers();
  const stdin = makeFakeStdin();
  const readStdin = makeReadStdin({ stdin }, timers.setTimeout, timers.clearTimeout);

  const p = readStdin(50, 200);
  stdin.emit('data', 'hello');
  stdin.emit('end');
  const result = await p;

  assert.equal(result, 'hello');
  assert.equal(timers.timers.size, 0, 'both the idle and the absolute timer must be cleared');
  assert.equal(stdin.listenerCount('data'), 0, 'finish() must detach the data listener');
});

test('resolves on the idle deadline when no end event ever arrives', async () => {
  const timers = makeFakeTimers();
  const stdin = makeFakeStdin();
  const readStdin = makeReadStdin({ stdin }, timers.setTimeout, timers.clearTimeout);

  const p = readStdin(50, 200);
  stdin.emit('data', 'partial');
  // No 'end'. Firing the idle timer (delay 50) is what must resolve this.
  timers.fireByDelay(50);
  const result = await p;

  assert.equal(result, 'partial');
  assert.equal(timers.timers.size, 0, 'the absolute timer must also be cleared once idle wins');
});

test('resolves on the absolute deadline while data keeps arriving and resetting the idle timer', async () => {
  const timers = makeFakeTimers();
  const stdin = makeFakeStdin();
  const readStdin = makeReadStdin({ stdin }, timers.setTimeout, timers.clearTimeout);

  const p = readStdin(50, 200);
  // Each data event resets the idle timer, so idle (delay 50) never fires on
  // its own here. Only the absolute deadline (delay 200) can end this.
  stdin.emit('data', 'a');
  stdin.emit('data', 'b');
  stdin.emit('data', 'c');
  timers.fireByDelay(200);
  const result = await p;

  assert.equal(result, 'abc', 'the buffer collected so far must resolve, cut mid-stream');
  assert.equal(timers.timers.size, 0, 'the still-pending idle timer must be cleared too');
});

test('finish() is idempotent: a late end after the deadline does not resolve twice or throw', async () => {
  const timers = makeFakeTimers();
  const stdin = makeFakeStdin();
  const readStdin = makeReadStdin({ stdin }, timers.setTimeout, timers.clearTimeout);

  const p = readStdin(50, 200);
  stdin.emit('data', 'x');
  timers.fireByDelay(200); // absolute deadline resolves first
  const result = await p;
  assert.equal(result, 'x');

  // The data listener was detached by finish(), so this has no effect; the
  // 'end' listener is still attached (only 'data' is removed), and calling it
  // again must be a no-op guarded by the done flag, not a second resolve or
  // a thrown error.
  let threw = false;
  try {
    stdin.emit('data', 'late');
    stdin.emit('end');
  } catch {
    threw = true;
  }
  assert.equal(threw, false, 'a late end after the deadline must not throw');
  // The promise is already settled; re-awaiting it must still yield the
  // original value, proving the late end did not smuggle in a second buffer.
  assert.equal(await p, 'x');
});
