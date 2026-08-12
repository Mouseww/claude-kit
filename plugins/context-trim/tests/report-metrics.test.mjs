// Regression tests for scripts/report-metrics.mjs.
//
//   node --test plugins/context-trim/tests/
//
// report-metrics.mjs takes the log path as argv[2], so every test builds a
// small fixture .jsonl under os.tmpdir(), runs the script as a subprocess
// against it (matching the spawnSync convention in truncate.test.mjs), and
// cleans the fixture up afterward.
//
// NOT covered here: the stop / stop_unattributed tagging decision in
// measure-subagent.mjs (FILE 2). Its LOG_FILE path is hardcoded to
// ~/.claude/context-offload-metrics.jsonl, and adding an env override purely
// to make that hook testable would introduce a configurable write path with
// no other benefit -- a live-data footgun for a unit test. This file instead
// proves that report-metrics.mjs correctly reads BOTH the legacy shape
// (agent "unknown", duration_s null) and the new tagged shape
// ('stop_unattributed') that hook emits, so the untested branch in FILE 2
// cannot corrupt the report even though it is not directly exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'report-metrics.mjs');

/** Write `records` (one JSON object each) to a fresh tmp .jsonl file and
 *  return its path. Caller is responsible for cleanup via cleanup(). */
function writeFixture(records) {
  const p = path.join(os.tmpdir(), `report-metrics-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

function cleanup(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // already gone; nothing to do
  }
}

/** Run the report against a fixture log and return stdout. */
function run(records) {
  const p = writeFixture(records);
  try {
    const res = spawnSync(process.execPath, [SCRIPT, p], { encoding: 'utf8' });
    return res.stdout || '';
  } finally {
    cleanup(p);
  }
}

const ts = (offsetSec = 0) => new Date(Date.now() + offsetSec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

test('legacy unattributed row (agent unknown, duration_s null) is excluded from the per-agent table and counted', () => {
  const out = run([
    { ts: ts(), event: 'stop', agent: 'unknown', agent_id: 'legacy-1', duration_s: null, returned_chars: 20 },
    { ts: ts(), event: 'stop', agent: 'dev-agents:quick-read', agent_id: 'a1', duration_s: 5, returned_chars: 100 },
  ]);
  // The legacy row must not appear as an "unknown" row in the per-agent table.
  const perAgentSection = out.split('== Real usage')[0];
  assert.doesNotMatch(perAgentSection, /\bunknown\s+1\b/);
  assert.match(out, /1 stop record\(s\) excluded/);
});

test('stop_unattributed row is excluded the same way', () => {
  const out = run([
    { ts: ts(), event: 'stop_unattributed', agent: null, agent_id: null, duration_s: null, returned_chars: 25 },
    { ts: ts(), event: 'stop', agent: 'dev-agents:quick-read', agent_id: 'a1', duration_s: 5, returned_chars: 100 },
  ]);
  assert.match(out, /1 stop record\(s\) excluded/);
});

test('both unattributed shapes together are counted in one total', () => {
  const out = run([
    { ts: ts(), event: 'stop', agent: 'unknown', agent_id: null, duration_s: null, returned_chars: 20 },
    { ts: ts(), event: 'stop_unattributed', agent: null, agent_id: null, duration_s: null, returned_chars: 25 },
    { ts: ts(), event: 'stop', agent: 'dev-agents:quick-read', agent_id: 'a1', duration_s: 5, returned_chars: 100 },
  ]);
  assert.match(out, /2 stop record\(s\) excluded/);
});

test('a run at 20x its agent median and above the floor appears under Runs worth a look, with a below-threshold run absent', () => {
  const records = [];
  // Build a stable median of 3s for dev-agents:quick-read across several calls.
  for (let i = 0; i < 9; i++) {
    records.push({
      ts: ts(i),
      event: 'stop',
      agent: 'dev-agents:quick-read',
      agent_id: `fast-${i}`,
      duration_s: 3,
      returned_chars: 100,
    });
  }
  // Stalled run: 20x the 3s median (60s) is below the 900s floor, so push it
  // past the floor too -- this is the case the floor exists to catch.
  records.push({
    ts: ts(100),
    event: 'stop',
    agent: 'dev-agents:quick-read',
    agent_id: 'stalled-1',
    duration_s: 1200,
    returned_chars: 30,
  });
  // Below both thresholds: slower than 3s but nowhere near the floor or 5x median.
  records.push({
    ts: ts(200),
    event: 'stop',
    agent: 'dev-agents:quick-read',
    agent_id: 'normal-1',
    duration_s: 10,
    returned_chars: 100,
  });
  const out = run(records);
  const section = out.split('== Runs worth a look ==')[1].split('== Real usage')[0];
  assert.match(section, /1200s/);
  assert.doesNotMatch(section, /normal-1/); // agent_id isn't printed, but duration is unique enough
  assert.doesNotMatch(section, /\s10s\s/);
});

test('tokens per second prints for a flagged run whose agent_usage record joins, and "-" when the join fails', () => {
  const records = [];
  for (let i = 0; i < 5; i++) {
    records.push({
      ts: ts(i),
      event: 'stop',
      agent: 'dev-agents:quick-read',
      agent_id: `fast-${i}`,
      duration_s: 2,
      returned_chars: 100,
    });
  }
  records.push({
    ts: ts(50),
    event: 'stop',
    agent: 'dev-agents:quick-read',
    agent_id: 'stalled-join',
    duration_s: 1000,
    returned_chars: 30,
  });
  records.push({
    ts: ts(51),
    event: 'stop',
    agent: 'dev-agents:quick-read',
    agent_id: 'stalled-nojoin',
    duration_s: 1000,
    returned_chars: 30,
  });
  // Only stalled-join has a matching agent_usage record.
  records.push({
    ts: ts(52),
    event: 'agent_usage',
    subagent_type: 'dev-agents:quick-read',
    usage: { agentId: 'stalled-join', totalTokens: 2000, totalDurationMs: 1000000 },
  });
  const out = run(records);
  const section = out.split('== Runs worth a look ==')[1].split('== Real usage')[0];
  assert.match(section, /tok\/s=2\.0/); // 2000 tokens / 1000s = 2.0
  assert.match(section, /tok\/s=-/); // stalled-nojoin has no matching usage record
});

test('the async_launched count is reported', () => {
  const out = run([
    { ts: ts(), event: 'stop', agent: 'dev-agents:quick-read', agent_id: 'a1', duration_s: 5, returned_chars: 100 },
    { ts: ts(), event: 'agent_usage', subagent_type: 'dev-agents:quick-read', usage: { agentId: 'a1', totalTokens: 500, totalDurationMs: 5000 } },
    { ts: ts(), event: 'agent_usage', subagent_type: 'dev-agents:quick-read', usage: { agentId: 'a2', status: 'async_launched' } },
    { ts: ts(), event: 'agent_usage', subagent_type: 'dev-agents:quick-read', usage: { agentId: 'a3', status: 'async_launched' } },
  ]);
  assert.match(out, /2 dispatch\(es\) were launched in the background/);
});

test('the per-agent table header shows p50/p90/max and no longer shows avg', () => {
  const out = run([
    { ts: ts(), event: 'stop', agent: 'dev-agents:quick-read', agent_id: 'a1', duration_s: 5, returned_chars: 100 },
  ]);
  assert.match(out, /p50 s/);
  assert.match(out, /p90 s/);
  assert.match(out, /max s/);
  assert.doesNotMatch(out, /avg sec/);
});
