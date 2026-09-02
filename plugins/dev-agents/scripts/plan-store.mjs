// The persisted task plan, shared by track-task-plan.mjs and
// require-task-plan.mjs.
//
// Why this exists: the reminder hook could previously only say "no plan
// exists". The plan itself lived in the conversation, so a long subagent run
// plus context compaction could discard it and leave the main thread with no
// record of the remaining steps. Writing it to a file makes it survive both.
// Borrowed from dsh-agent-teams, where the whole team state is a file and the
// UI, the scheduler and a cold restart all read it back (state.ts).
//
// Why the revision field: a single message can dispatch several Agent calls,
// and each one runs these hooks concurrently. Without a compare-and-swap the
// last writer wins even when it read an older copy, silently discarding a
// newer plan. dsh solves the same problem with a monotonic attempt counter
// plus a token checked at submit time (types.ts:90-139); a revision is the
// same idea with one writer per record.
//
// This module is pure and exported so it can be unit tested without spawning
// a hook. Precedent for a sibling import inside one plugin:
// plugins/claude-kit-meta/scripts/check-daily-update.mjs.

import fs from 'node:fs';
import path from 'node:path';

const MAX_STEPS = 200;
const MAX_TEXT = 300;

export function planPath(stateDir, session) {
  const safe = String(session || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(stateDir, `plan-${safe}.json`);
}

// Returns null for absent, unreadable or corrupt. A caller must not be able to
// tell the difference, because in every one of those cases the right move is
// to write a fresh record.
export function readPlan(stateDir, session) {
  try {
    const parsed = JSON.parse(fs.readFileSync(planPath(stateDir, session), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Number.isInteger(parsed.revision) || parsed.revision < 1) return null;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// mutate(current) returns { steps, raw }. current is the record on disk, or a
// blank one at revision 0 when there is none.
//
// The revision check NARROWS the clobber window; it does not close it. A writer
// that reads revision N, is beaten to the disk by another writer, and only then
// tries to write, is correctly rejected and retries — that is the "late arrival"
// case this exists for, and it is the one that actually happens when a long
// subagent returns after the plan moved on. What is NOT prevented: two writers
// that both read N and both pass the re-read before either renames. The second
// rename wins silently. Closing that would need an exclusive per-revision claim,
// and an orphaned claim from a crashed hook would wedge the store until the 24h
// prune collected it, which is a worse failure than a lost update. Both callers
// today derive their payload from the same tool_input, so a lost simultaneous
// write costs nothing; a future caller with a genuinely independent payload
// should not assume this is a lock.
export function writePlan(stateDir, session, mutate, maxRetries = 3) {
  const file = planPath(stateDir, session);
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const current = readPlan(stateDir, session) ?? { revision: 0, updatedAt: 0, steps: [], raw: null };
    let next;
    try {
      next = mutate(current);
    } catch {
      return { ok: false, revision: current.revision, reason: 'mutate-threw' };
    }
    if (!next || typeof next !== 'object') {
      return { ok: false, revision: current.revision, reason: 'mutate-returned-nothing' };
    }
    const record = {
      revision: current.revision + 1,
      updatedAt: Date.now(),
      steps: normalizeSteps(next.steps),
      raw: next.raw ?? null,
    };
    // Re-read immediately before writing. Another process that wrote in the
    // window between our read and now must not be overwritten.
    const latest = readPlan(stateDir, session);
    const latestRevision = latest ? latest.revision : 0;
    if (latestRevision !== current.revision) continue;
    if (atomicWriteJson(file, record)) {
      return { ok: true, revision: record.revision };
    }
    return { ok: false, revision: current.revision, reason: 'write-failed' };
  }
  const final = readPlan(stateDir, session);
  return { ok: false, revision: final ? final.revision : 0, reason: 'revision-conflict' };
}

// Same tmp-and-rename shape as the shared:atomicWrite helper in the hook
// scripts, but NOT wrapped in shared: markers and NOT registered in
// tests/hook-helpers.mjs. That block is byte-shared across six hook scripts
// and checked for drift; this one serializes JSON, is only ever called from
// this module, and lives inside a single plugin, so it is deliberately kept
// local rather than promoted to the shared registry.
function atomicWriteJson(file, record) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* already there, or unwritable; the write below reports it */
  }
  const text = JSON.stringify(record);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
    }
  }
  try {
    fs.writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, MAX_STEPS).map((s) => ({
    text: String(s?.text ?? '').slice(0, MAX_TEXT),
    status: String(s?.status ?? 'pending'),
  }));
}

// The plan-creating tool's payload shape is not documented in this repo, and
// it differs between harness builds. Rather than assume one, probe the keys
// that have been observed and fall back to an empty list. writePlan also
// stores the payload verbatim under `raw`, so a real session shows the true
// shape and this function can be tightened from evidence.
const LIST_KEYS = ['todos', 'tasks', 'steps', 'plan', 'items'];
const TEXT_KEYS = ['content', 'text', 'title', 'subject', 'name', 'description'];
const STATUS_KEYS = ['status', 'state'];

export function extractSteps(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  let list = null;
  for (const key of LIST_KEYS) {
    if (Array.isArray(toolInput[key])) {
      list = toolInput[key];
      break;
    }
  }
  if (!list) return [];
  const out = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      out.push({ text: entry, status: 'pending' });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    let text = '';
    for (const key of TEXT_KEYS) {
      if (typeof entry[key] === 'string' && entry[key]) {
        text = entry[key];
        break;
      }
    }
    if (!text) continue;
    let status = 'pending';
    for (const key of STATUS_KEYS) {
      if (typeof entry[key] === 'string' && entry[key]) {
        status = entry[key];
        break;
      }
    }
    out.push({ text, status });
  }
  return normalizeSteps(out);
}

const DONE = new Set(['completed', 'complete', 'done', 'cancelled', 'canceled', 'failed']);

// The text injected back into the model's context. Empty string means there is
// nothing worth saying, and the caller must then inject nothing at all rather
// than an empty section.
export function formatRemaining(plan, limit = 8) {
  if (!plan || !Array.isArray(plan.steps)) return '';
  const remaining = plan.steps.filter((s) => !DONE.has(String(s.status).toLowerCase()));
  if (remaining.length === 0) return '';
  const shown = remaining.slice(0, limit);
  const lines = shown.map((s) => `  - [${s.status}] ${s.text}`);
  if (remaining.length > shown.length) {
    lines.push(`  - ... and ${remaining.length - shown.length} more`);
  }
  return lines.join('\n');
}
