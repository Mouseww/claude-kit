#!/usr/bin/env node
// PostToolUse hook (matcher: TaskCreate) for the dev-agents plugin.
//
// Half of a pair. When a task plan is created, drop a per-session flag so the
// PreToolUse hook on Agent (require-task-plan.mjs) knows one exists.
//
// The failure this pair prevents: the main thread says in conversation "next I
// will do 1, 2, 3", dispatches a subagent for step 1, and while that runs the
// history gets compacted and the spoken plan is dropped. The subagent returns
// and the main thread no longer knows steps 2 and 3 exist. A tracked task list
// survives compaction; a sentence in the transcript does not.
//
// Never blocks, never returns hook JSON, always exits 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePlan, extractSteps } from './plan-store.mjs';

const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

// Some harness builds expose the plan-creating tool under one name, some the
// other. Matching only TaskCreate means the store may never get written.
const PLAN_TOOLS = new Set(['TaskCreate', 'TodoWrite']);

const HOUR = 60 * 60 * 1000;
const PRUNE_RULES = [
  { suffix: '.tmp', ttlMs: 24 * HOUR },
  { prefix: 'has-plan-', ttlMs: 24 * HOUR },
  { prefix: 'nudged-', ttlMs: 24 * HOUR },
  { prefix: 'bg-warned-', ttlMs: 24 * HOUR },
  { prefix: 'unbounded-warned-', ttlMs: 24 * HOUR },
  { prefix: 'content-fetch-warned-', ttlMs: 24 * HOUR },
  { prefix: 'bg-ack-', ttlMs: 24 * HOUR },
  { prefix: 'thin-warned-', ttlMs: 24 * HOUR },
  { prefix: 'plan-', ttlMs: 24 * HOUR },
];

// --- shared:readStdin --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Two deadlines on purpose. The idle timer covers the common case of a stream
// that goes quiet without an end event. The absolute one covers a stream that
// keeps producing, which resets the idle timer forever and used to mean this
// never resolved at all. Both resolve with whatever arrived; a partial body
// fails JSON.parse and every caller treats that as "do nothing".
//
// finish() detaches from stdin as well as resolving. Resolving alone is not
// enough: a stream that is still flowing keeps the process alive long after the
// promise settles, so the hook would sail past its own deadline and hang. The
// detach is what makes the absolute deadline actually bound the process.
function readStdin(idleMs = 5000, absoluteMs = 30000) {
  return new Promise((resolve) => {
    let buf = '';
    let idle = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (idle) clearTimeout(idle);
      clearTimeout(hard);
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
      resolve(buf);
    };
    const hard = setTimeout(finish, absoluteMs);
    hard.unref();
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(finish, idleMs);
      idle.unref();
    };
    process.stdin.setEncoding('utf8');
    resetIdle();
    process.stdin.on('data', (c) => {
      buf += c;
      resetIdle();
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}
// --- /shared:readStdin ---

// --- shared:quiet --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
// --- /shared:quiet ---

// --- shared:pruneStale --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Per-rule TTLs, because a subagent start marker is stale after hours while a
// session flag is not. A rule matches on prefix, on suffix, or on both: the
// files in this directory are named both ways, `has-plan-<session>.flag` from
// the front and `<session>.streak` from the back, so prefix-only matching
// cannot express every owner. A rule with neither field is ignored rather than
// treated as a wildcard, because this directory is shared and a wildcard would
// delete other packs' state. Nothing here may throw: a hook that died during
// housekeeping would drop the work it was actually called to do.
function pruneStale(stateDir, rules) {
  quiet(() => {
    const now = Date.now();
    for (const name of fs.readdirSync(stateDir)) {
      const rule = rules.find(
        (r) =>
          (r.prefix !== undefined || r.suffix !== undefined) &&
          (r.prefix === undefined || name.startsWith(r.prefix)) &&
          (r.suffix === undefined || name.endsWith(r.suffix))
      );
      if (!rule) continue;
      const p = path.join(stateDir, name);
      quiet(() => {
        if (now - fs.statSync(p).mtimeMs > rule.ttlMs) fs.unlinkSync(p);
      });
    }
  });
}
// --- /shared:pruneStale ---

// --- shared:atomicWrite --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Write to a unique temp name, then rename over the target. rename is atomic
// on POSIX and near enough on NTFS, so a concurrent reader sees either the old
// bytes or the new ones, never a half-written file. Parallel Agent dispatches
// in one message run these hooks at the same time, which is when this matters.
// Windows can still return EPERM on the rename when a scanner or another
// process holds the target, so retry, then fall back to a direct write:
// a torn file is bad, but losing the state entirely is worse.
function atomicWrite(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* already there, or unwritable; the write below reports it */
  }
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
    fs.unlinkSync(tmp);
  } catch {
    /* Reached only when all three rename attempts failed and this cleanup failed
       too, which leaves one orphaned .tmp beside the target. That bound of one is
       why the name is computed once and reused across attempts rather than
       regenerated each time, which would allow up to three. Nothing here tracks
       or removes them afterwards. */
  }
  try {
    fs.writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}
// --- /shared:atomicWrite ---

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  // Guard on the tool name as well as the hooks.json matcher.
  if (!PLAN_TOOLS.has(input.tool_name)) return;

  // Sanitize before using the session id in a filename. The bash original
  // interpolated it raw, so an id containing a path separator would have
  // written outside the state directory.
  const session = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));

  // Sweep flags from sessions that ended long ago; nothing else deletes them.
  pruneStale(STATE_DIR, PRUNE_RULES);

  // The flag answers "does a plan exist". The record answers "what is left in
  // it", which is what survives a compaction. Both, on purpose.
  quiet(() => atomicWrite(path.join(STATE_DIR, `has-plan-${session}.flag`), '1'));
  const steps = extractSteps(input.tool_input);
  quiet(() => writePlan(STATE_DIR, session, () => ({ steps, raw: input.tool_input ?? null })));

  // A plan now exists, so reset the nudge counter. If the plan is later
  // abandoned and a fresh multi-step task starts without one, the reminder
  // should come back rather than stay permanently silenced.
  quiet(() => fs.unlinkSync(path.join(STATE_DIR, `nudged-${session}.count`)));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
