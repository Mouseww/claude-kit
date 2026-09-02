// Tests for the persisted task plan and its revision guard.
//
//   node --test plugins/dev-agents/tests/plan-store.test.mjs
//
// The store is a pure module, so these call it directly rather than spawning
// the hooks. Each test gets its own state directory under the OS temp dir and
// removes it afterwards.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  planPath,
  readPlan,
  writePlan,
  extractSteps,
  formatRemaining,
} from '../scripts/plan-store.mjs';

const dirs = new Set();
function newDir(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `plan-store-${label}-`));
  dirs.add(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs.clear();
});

test('readPlan returns null when nothing has been written', () => {
  assert.equal(readPlan(newDir('empty'), 'sess'), null);
});

test('writePlan creates the record at revision 1', () => {
  const dir = newDir('create');
  const res = writePlan(dir, 'sess', () => ({ steps: [{ text: 'a', status: 'pending' }], raw: null }));
  assert.equal(res.ok, true);
  assert.equal(res.revision, 1);
  const plan = readPlan(dir, 'sess');
  assert.equal(plan.revision, 1);
  assert.deepEqual(plan.steps, [{ text: 'a', status: 'pending' }]);
});

test('each successful write advances the revision by exactly one', () => {
  const dir = newDir('advance');
  writePlan(dir, 'sess', () => ({ steps: [], raw: null }));
  const second = writePlan(dir, 'sess', (cur) => ({
    steps: [...cur.steps, { text: 'b', status: 'pending' }],
    raw: null,
  }));
  assert.equal(second.revision, 2);
  assert.equal(readPlan(dir, 'sess').steps.length, 1);
});

test('the mutate callback receives the current record, not a blank one', () => {
  const dir = newDir('receives');
  writePlan(dir, 'sess', () => ({ steps: [{ text: 'first', status: 'done' }], raw: null }));
  let seen = null;
  writePlan(dir, 'sess', (cur) => {
    seen = cur;
    return { steps: cur.steps, raw: null };
  });
  assert.equal(seen.revision, 1);
  assert.deepEqual(seen.steps, [{ text: 'first', status: 'done' }]);
});

test('a stale writer is rejected instead of clobbering a newer plan', () => {
  const dir = newDir('stale');
  writePlan(dir, 'sess', () => ({ steps: [{ text: 'original', status: 'pending' }], raw: null }));
  // Simulate a late parallel hook: it read revision 1, then someone else wrote
  // revision 2 before it got to write. mutate advances the file underneath it
  // on every attempt, so its compare-and-swap can never succeed.
  const res = writePlan(
    dir,
    'sess',
    (cur) => {
      const bumped = { revision: cur.revision + 1, updatedAt: Date.now(), steps: [{ text: 'newer', status: 'pending' }], raw: null };
      fs.writeFileSync(planPath(dir, 'sess'), JSON.stringify(bumped));
      return { steps: [{ text: 'stale overwrite', status: 'pending' }], raw: null };
    },
    2
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'revision-conflict');
  assert.equal(readPlan(dir, 'sess').steps[0].text, 'newer', 'the newer plan must survive');
});

test('a corrupt record is treated as absent rather than throwing', () => {
  const dir = newDir('corrupt');
  fs.writeFileSync(planPath(dir, 'sess'), '{"revision":1,"ste');
  assert.equal(readPlan(dir, 'sess'), null);
  const res = writePlan(dir, 'sess', () => ({ steps: [], raw: null }));
  assert.equal(res.ok, true, 'a corrupt file must not wedge the store');
});

test('extractSteps reads a todos array of objects with content and status', () => {
  const steps = extractSteps({ todos: [{ content: 'do a thing', status: 'in_progress' }] });
  assert.deepEqual(steps, [{ text: 'do a thing', status: 'in_progress' }]);
});

test('extractSteps reads a tasks array under an alternative key', () => {
  const steps = extractSteps({ tasks: [{ title: 'ship it', state: 'pending' }] });
  assert.deepEqual(steps, [{ text: 'ship it', status: 'pending' }]);
});

test('extractSteps accepts a plain array of strings', () => {
  assert.deepEqual(extractSteps({ todos: ['one', 'two'] }), [
    { text: 'one', status: 'pending' },
    { text: 'two', status: 'pending' },
  ]);
});

test('extractSteps returns an empty array for a shape it does not recognize', () => {
  assert.deepEqual(extractSteps({ something: 'else' }), []);
  assert.deepEqual(extractSteps(null), []);
});

test('formatRemaining lists only the steps that are not done', () => {
  const plan = {
    revision: 1,
    updatedAt: Date.now(),
    steps: [
      { text: 'done thing', status: 'completed' },
      { text: 'current thing', status: 'in_progress' },
      { text: 'later thing', status: 'pending' },
    ],
    raw: null,
  };
  const out = formatRemaining(plan);
  assert.doesNotMatch(out, /done thing/);
  assert.match(out, /current thing/);
  assert.match(out, /later thing/);
});

test('formatRemaining caps the list and says how many were omitted', () => {
  const steps = Array.from({ length: 12 }, (_, i) => ({ text: `step ${i}`, status: 'pending' }));
  const out = formatRemaining({ revision: 1, updatedAt: Date.now(), steps, raw: null }, 3);
  assert.match(out, /step 0/);
  assert.doesNotMatch(out, /step 5/);
  assert.match(out, /9 more/);
});

test('formatRemaining returns an empty string when every step is done', () => {
  const plan = { revision: 1, updatedAt: Date.now(), steps: [{ text: 'a', status: 'completed' }], raw: null };
  assert.equal(formatRemaining(plan), '');
});
