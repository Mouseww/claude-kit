#!/usr/bin/env node
// Summarize what the measure-subagent hook collected.
//
//   node "<plugin dir>/scripts/report-metrics.mjs" [path-to-metrics.jsonl]
//
// Reads ~/.claude/context-offload-metrics.jsonl by default. Requires only node.
//
// The questions this answers:
//   1. Which agents actually get used? An agent with 0 invocations after a week
//      is dead weight in the always-resident agent list. Delete it.
//   2. How much context does each delegation hand back? returned_chars is the
//      direct cost. A quick-read that routinely returns 4,000+ chars is not
//      distilling anything, so that delegation is close to net zero.
//   3. Do role agents delegate down to quick-read at all? If backend-dev ran 20
//      times and quick-read never fired, nested delegation is not happening and
//      the prompt wording asking for it is wasted tokens.
//   4. Is any run stalled right now? A mean duration hides the single
//      pathological run, which is the whole point of looking: a real 3-hour
//      stalled dev-agents:quick-read run sat in this log for six days while its
//      "avg sec" column read 192 across 108 calls, because 107 fast calls
//      buried the one that mattered. p50/p90/max and the flagged-runs section
//      below exist so that run cannot hide in an average again.
//   5. Is a row actually an agent? A stop record with no agent_type and no
//      matching start event identifies nothing and carries no duration. Left
//      in the per-agent table it renders as a top-row agent named "unknown",
//      reading like real subagent activity when it is not.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG = process.argv[2] || path.join(os.homedir(), '.claude', 'context-offload-metrics.jsonl');

// A run has to clear BOTH a floor and a multiple of its own agent's median to
// get flagged. The factor alone would flag a fast agent whose normal run is
// two seconds; the floor alone would never flag an agent that is slow by
// nature. Together they catch "this specific run is an outlier for this
// agent, and it is not just slow, it is actually stuck".
const STALL_FLOOR_S = 900;
const STALL_FACTOR = 5;

if (!fs.existsSync(LOG)) {
  console.log(`Metrics log not found: ${LOG}`);
  console.log(
    'The hook has not run yet. Confirm the plugin is loaded (/plugin, /hooks), then spawn a subagent.'
  );
  process.exit(1);
}

// A crashed session can leave a half-written line. Parsing the whole file at
// once would fail on all of it and every table below would silently come back
// empty, so filter to parseable lines first and say how many were dropped.
const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.trim() !== '');
const records = [];
let malformed = 0;
for (const line of lines) {
  try {
    records.push(JSON.parse(line));
  } catch {
    malformed++;
  }
}

console.log(`Metrics log: ${LOG}`);
console.log(
  `Records: ${records.length} parseable` +
    (malformed ? ` (${malformed} malformed line(s) skipped)` : '')
);
console.log('');

// A stop record with no agent_type and no matching start event (so
// duration_s never resolved) identifies nothing. It is either the legacy
// shape already sitting in existing logs (agent "unknown", duration_s null)
// or the tagged shape measure-subagent.mjs now writes ('stop_unattributed').
// Pull both out before the per-agent table is built, or they render as a
// top-row agent named "unknown" that reads like real subagent activity.
const allStops = records.filter((r) => r.event === 'stop' || r.event === 'stop_unattributed');
const unattributed = allStops.filter(
  (r) => r.event === 'stop_unattributed' || ((r.agent == null || r.agent === 'unknown') && r.duration_s == null)
);
const stops = allStops.filter((r) => !unattributed.includes(r));

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Same shape as median but for an arbitrary quantile, used to get p50/p90
// per agent and the per-agent threshold for the stall check below.
function percentile(nums, q) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * q));
  return s[idx];
}

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function pad(s, w, right = false) {
  s = String(s);
  return right ? s.padStart(w) : s.padEnd(w);
}

console.log('== Per-agent invocations ==');
console.log(
  pad('agent', 34) + pad('calls', 6, true) + pad('median chars', 15, true) +
    pad('max chars', 13, true) + pad('p50 s', 8, true) + pad('p90 s', 8, true) + pad('max s', 8, true)
);
console.log('-'.repeat(94));

const perAgent = [...groupBy(stops, (r) => r.agent ?? 'unknown').entries()]
  .map(([agent, rs]) => {
    const chars = rs.map((r) => Number(r.returned_chars) || 0);
    const durs = rs.map((r) => r.duration_s).filter((d) => d != null).map(Number);
    return {
      agent,
      n: rs.length,
      med: median(chars),
      max: chars.length ? Math.max(...chars) : 0,
      p50: durs.length ? percentile(durs, 0.5) : null,
      p90: durs.length ? percentile(durs, 0.9) : null,
      maxDur: durs.length ? Math.max(...durs) : null,
    };
  })
  .sort((a, b) => b.n - a.n);

for (const a of perAgent) {
  console.log(
    pad(a.agent, 34) + pad(a.n, 6, true) + pad(a.med, 15, true) +
      pad(a.max, 13, true) + pad(a.p50 == null ? '-' : a.p50, 8, true) +
      pad(a.p90 == null ? '-' : a.p90, 8, true) + pad(a.maxDur == null ? '-' : a.maxDur, 8, true)
  );
}

console.log('');
console.log(
  `${unattributed.length} stop record(s) excluded above: no agent_type and no matching start event ` +
    `means the row identifies nothing and carries no duration. Left in, they previously rendered as ` +
    `a top-row agent named "unknown".`
);

// Real token usage, if this Claude Code version emits it. Field names vary, so
// probe several spellings rather than assuming one. Declared here (ahead of
// the "Real usage" section that formats it) so the stall check below can join
// against it too.
const usages = records.filter((r) => r.event === 'agent_usage');
// agent_usage.usage carries the raw PostToolUse tool_response, and agentId is
// how it lines up with a stop record's agent_id -- neither subagent_type nor
// session_id is unique enough per-call to do this join safely.
const usageByAgentId = new Map();
for (const r of usages) {
  const id = r.usage && r.usage.agentId;
  if (id) usageByAgentId.set(id, r.usage);
}

console.log('');
console.log('== Runs worth a look ==');
// A run has to be both an outlier for ITS agent (STALL_FACTOR * that agent's
// own p50) and slow in absolute terms (STALL_FLOOR_S) to show up here. See
// the constants' comment above for why neither threshold alone is enough.
const p50ByAgent = new Map(perAgent.map((a) => [a.agent, a.p50]));
const flagged = stops
  .filter((r) => r.duration_s != null)
  .map((r) => {
    const p50 = p50ByAgent.get(r.agent ?? 'unknown') || 0;
    const threshold = Math.max(STALL_FLOOR_S, STALL_FACTOR * p50);
    return { r, threshold };
  })
  .filter(({ r, threshold }) => r.duration_s >= threshold)
  .sort((a, b) => b.r.duration_s - a.r.duration_s)
  .slice(0, 10);

if (flagged.length === 0) {
  console.log('  Nothing crossed both the floor and the per-agent factor. No stalled runs found.');
} else {
  for (const { r } of flagged) {
    const u = usageByAgentId.get(r.agent_id);
    const tok = u && u.totalTokens;
    const ms = u && u.totalDurationMs;
    const tps = tok != null && ms ? (Number(tok) / (Number(ms) / 1000)).toFixed(1) : '-';
    console.log(
      `  ${r.agent}  ${r.duration_s}s  returned_chars=${r.returned_chars ?? '-'}  tok/s=${tps}  ${r.ts}`
    );
  }
}
console.log('');
console.log(
  '  A low tokens/s rate means the run was idle or blocked rather than working -- compare it'
);
console.log(
  '  against that same agent\'s rate in "Real usage" below. Two thresholds, not one, because a'
);
console.log(
  '  factor alone would flag a fast agent whose normal run is two seconds, and a floor alone'
);
console.log('  would never flag an agent that is slow by nature.');

if (usages.length > 0) {
  console.log('');
  console.log("== Real usage (from the Agent tool's PostToolUse telemetry) ==");
  const rows = usages.map((r) => {
    const u = r.usage || {};
    const nested = u.usage || {};
    const tok =
      u.totalTokens ??
      nested.total_tokens ??
      (Number(nested.input_tokens || 0) + Number(nested.output_tokens || 0));
    return {
      t: r.subagent_type || 'unknown',
      model: u.resolvedModel || r.requested_model || '-',
      tok: Number(tok) || 0,
      ms: Number(u.totalDurationMs) || 0,
    };
  });
  const grouped = [...groupBy(rows, (r) => r.t).entries()]
    .map(([t, rs]) => ({
      t,
      n: rs.length,
      model: rs[0].model,
      tok: rs.reduce((a, b) => a + b.tok, 0),
      ms: rs.reduce((a, b) => a + b.ms, 0),
    }))
    .sort((a, b) => b.tok - a.tok);
  for (const g of grouped) {
    const tps = g.ms > 0 ? (g.tok / (g.ms / 1000)).toFixed(1) : '-';
    console.log(
      `  ${g.t}  x${g.n}  model=${g.model}  tokens=${g.tok}  ${Math.floor(g.ms / 1000)}s  tok/s=${tps}`
    );
  }
  console.log('  (tokens=0 means your Claude Code version uses field names this script does');
  console.log('   not probe for. Inspect one agent_usage record in the log to see the actual');
  console.log('   shape, then add those names to this script.)');

  // A backgrounded dispatch is the recommended way to stop one stalled
  // subagent blocking its siblings, but Claude Code reports no token usage
  // for it, so taking that advice silently removes the run from every total
  // above. Say so, or the totals read as complete when they are not.
  const asyncLaunched = usages.filter((r) => r.usage && r.usage.status === 'async_launched').length;
  if (asyncLaunched > 0) {
    console.log('');
    console.log(
      `  ${asyncLaunched} dispatch(es) were launched in the background. Claude Code reports no ` +
        `token usage for those, so the totals above undercount by ${asyncLaunched} run(s).`
    );
  }
}

console.log('');
console.log('== Does nested delegation actually happen? ==');
// agent_type for a plugin-shipped subagent is namespaced, e.g.
// "dev-agents:deepthink", so every pattern must tolerate a "<plugin>:" prefix.
const ROLE_RE =
  /(^|:)(deepthink|requirements-analyst|backend-dev|frontend-dev|ui-ux-designer|test-engineer|quality-reviewer|devops-engineer)$/;
const role = stops.filter((r) => ROLE_RE.test(r.agent || '')).length;
const qr = stops.filter((r) => /(^|:)quick-read$/.test(r.agent || '')).length;
console.log(`role agents / deepthink invoked: ${role}`);
console.log(`quick-read invoked:            ${qr}`);
if (role > 5 && qr === 0) {
  console.log('');
  console.log(`  -> role agents ran ${role} times and quick-read never fired.`);
  console.log("     Nested delegation is not happening. Delete the 'Delegate read-only");
  console.log("     exploration to quick-read' line from each agent prompt and rely on");
  console.log('     main-thread orchestration instead; that prompt text is dead weight.');
}

console.log('');
console.log('== Agents returning a lot of text (possibly not distilling anything) ==');
for (const a of perAgent) {
  if (a.med > 3000) {
    console.log(
      `  ${a.agent}: median ${a.med} chars returned. That is close to just reading the file inline; check that its prompt asks for conclusions only`
    );
  }
}

console.log('');
console.log(
  'Note: let this run for a few days. A single sample means nothing; look at trends and relative size.'
);
