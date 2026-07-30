#!/usr/bin/env node
// Summarize what the measure-subagent hook collected.
//
//   node "<plugin dir>/scripts/report-metrics.mjs" [path-to-metrics.jsonl]
//
// Reads ~/.claude/context-offload-metrics.jsonl by default. Requires only node.
//
// The three questions this answers:
//   1. Which agents actually get used? An agent with 0 invocations after a week
//      is dead weight in the always-resident agent list. Delete it.
//   2. How much context does each delegation hand back? returned_chars is the
//      direct cost. A quick-read that routinely returns 4,000+ chars is not
//      distilling anything, so that delegation is close to net zero.
//   3. Do role agents delegate down to quick-read at all? If backend-dev ran 20
//      times and quick-read never fired, nested delegation is not happening and
//      the prompt wording asking for it is wasted tokens.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG = process.argv[2] || path.join(os.homedir(), '.claude', 'context-offload-metrics.jsonl');

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

const stops = records.filter((r) => r.event === 'stop');

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
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
    pad('max chars', 13, true) + pad('avg sec', 10, true)
);
console.log('-'.repeat(80));

const perAgent = [...groupBy(stops, (r) => r.agent ?? 'unknown').entries()]
  .map(([agent, rs]) => {
    const chars = rs.map((r) => Number(r.returned_chars) || 0);
    const durs = rs.map((r) => r.duration_s).filter((d) => d != null).map(Number);
    return {
      agent,
      n: rs.length,
      med: median(chars),
      max: chars.length ? Math.max(...chars) : 0,
      dur: durs.length ? Math.floor(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
    };
  })
  .sort((a, b) => b.n - a.n);

for (const a of perAgent) {
  console.log(
    pad(a.agent, 34) + pad(a.n, 6, true) + pad(a.med, 15, true) +
      pad(a.max, 13, true) + pad(a.dur == null ? '-' : a.dur, 10, true)
  );
}

// Real token usage, if this Claude Code version emits it. Field names vary, so
// probe several spellings rather than assuming one.
const usages = records.filter((r) => r.event === 'agent_usage');
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
    console.log(`  ${g.t}  x${g.n}  model=${g.model}  tokens=${g.tok}  ${Math.floor(g.ms / 1000)}s`);
  }
  console.log('  (tokens=0 means your Claude Code version uses field names this script does');
  console.log('   not probe for. Inspect one agent_usage record in the log to see the actual');
  console.log('   shape, then add those names to this script.)');
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
