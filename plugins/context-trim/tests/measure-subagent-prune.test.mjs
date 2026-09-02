// Regression test for the pruneStale rule ordering in measure-subagent.mjs.
//
//   node --test plugins/context-trim/tests/measure-subagent-prune.test.mjs
//
// rules.find returns the FIRST match, so a `.tmp` orphan named in the real
// shape a start marker leaves behind, `start-<key>.<pid>.<ts>.tmp`, matches
// BOTH the `start-` prefix rule (12h TTL) and the `.tmp` suffix rule (24h
// TTL). Whichever rule sits first in PRUNE_RULES silently wins. This test
// pins the correct order: the `.tmp` rule must be listed first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'measure-subagent.mjs');
const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

test('an 18h-old start-marker .tmp orphan survives, because .tmp (24h) must be matched before start- (12h)', () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const session = `prune-order-${process.pid}-${Date.now()}`;
  // Real orphan shape: a start marker's atomicWrite tmp file that was never
  // cleaned up, so it carries both the `start-` prefix and the `.tmp` suffix.
  const orphan = path.join(STATE_DIR, `start-${session}.12345.1700000000000.tmp`);
  fs.writeFileSync(orphan, '1700000000');
  // 18 hours: past the 12h start- TTL, short of the 24h .tmp TTL. Do not
  // change this to 25 -- 18 is the value that only passes when .tmp is
  // matched first; 25 would pass either way and stop catching a reorder.
  const old = Date.now() - 18 * 60 * 60 * 1000;
  fs.utimesSync(orphan, old / 1000, old / 1000);

  try {
    const res = spawnSync(process.execPath, [SCRIPT], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'unrelated' }),
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `measure-subagent.mjs exited ${res.status}: ${res.stderr}`);
    assert.equal(fs.existsSync(orphan), true, 'an 18h-old .tmp orphan must survive a 24h .tmp TTL');
  } finally {
    try {
      fs.unlinkSync(orphan);
    } catch {
      /* already gone */
    }
  }
});
