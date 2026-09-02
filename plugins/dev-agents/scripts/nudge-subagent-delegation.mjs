#!/usr/bin/env node
// PostToolUse hook for the dev-agents plugin. Single cross-platform
// implementation; requires only node. The real matcher lives in
// hooks/hooks.json and is a whitelist, not "*".
//
// Tracks two separate streaks in the main thread and nudges once past each
// threshold:
//
//   READ streak  (Read/Grep/Glob)   -> suggest quick-read
//   WRITE streak (Edit/Write)       -> suggest quick-io / a role agent
//
// Why the write branch exists at all. An earlier version only counted reads,
// and that asymmetry had a measurable consequence: quick-read (haiku) got used
// for exploration while every line of code kept being written by the main
// thread on an expensive model. That was not the model being lazy. The
// rationale "keep raw output out of the main thread" is true for a read and
// simply does not apply to a write, so nothing ever pointed at the write path.
//
// The write nudge is deliberately careful. A hook cannot tell whether an edit
// is mechanical or needs judgement, so the message is conditional rather than
// an instruction: it asks whether the REMAINING edits are already-decided work.
// Over-nudging on writes is worse than on reads, because a wrong handoff costs
// a round trip and can produce code that has to be redone.
//
// State: one file per session under the temp dir holding
// `{ mode, n, paths }` as JSON (a legacy "<MODE>:<count>" body is still read).
// Switching mode resets the count, which is what makes a streak consecutive
// rather than cumulative. Files older than a day are swept opportunistically.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- tunables --------------------------------------------------------------
const READ_THRESHOLD = 16; // consecutive Read/Grep/Glob before the first read nudge
const READ_REPEAT = 15; // and every N after that
const WRITE_THRESHOLD = 8; // consecutive Edit/Write before the first write nudge
const WRITE_REPEAT = 10; // and every N after that
// -----------------------------------------------------------------------------

const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

const HOUR = 60 * 60 * 1000;
const PRUNE_RULES = [
  { suffix: '.tmp', ttlMs: 24 * HOUR },
  { suffix: '.streak', ttlMs: 24 * HOUR },
  { suffix: '.count', ttlMs: 24 * HOUR },
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

// Which shape the recent reads have. The advice that follows is only useful if
// it names the actual mistake: re-reading one file is a different problem from
// sweeping a directory, and both are different from a scattered hunt.
// Exported for the unit tests; the hook itself calls it internally.
export function classifyReadPattern(paths) {
  const usable = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
  if (usable.length === 0) return 'scattered';
  const norm = usable.map((p) => p.replace(/\\/g, '/'));
  const files = new Set(norm);
  // One file dominating the window means it is being re-read, not explored.
  const counts = new Map();
  for (const p of norm) counts.set(p, (counts.get(p) ?? 0) + 1);
  const topCount = Math.max(...counts.values());
  if (topCount >= Math.ceil(norm.length * 0.6) && topCount >= 3) return 'same-file';
  const dirs = new Set(norm.map((p) => p.slice(0, p.lastIndexOf('/') + 1)));
  if (dirs.size === 1 && files.size >= 3) return 'same-dir';
  return 'scattered';
}

// The streak file used to hold `MODE:COUNT` as plain text. Parse JSON first,
// fall back to the legacy form, and treat anything else as a fresh window.
// The mode letter is what makes these counts consecutive-per-mode rather than
// cumulative: the streak resets when reads switch to writes.
function readStreak(file) {
  const raw = quiet(() => fs.readFileSync(file, 'utf8'));
  if (!raw) return { mode: '', n: 0, paths: [] };
  const parsed = quiet(() => JSON.parse(raw));
  if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.n)) {
    return {
      mode: typeof parsed.mode === 'string' ? parsed.mode : '',
      n: parsed.n,
      paths: Array.isArray(parsed.paths) ? parsed.paths : [],
    };
  }
  // A corrupted fragment could in principle split into a valid-looking
  // `MODE:COUNT`; the blast radius is one session's streak count, and any other
  // malformed body yields an empty mode that matches nothing and resets.
  const idx = String(raw).trim().indexOf(':');
  if (idx > 0) {
    const legacyMode = String(raw).trim().slice(0, idx);
    const legacyN = String(raw).trim().slice(idx + 1);
    if (/^\d+$/.test(legacyN)) return { mode: legacyMode, n: Number(legacyN), paths: [] };
  }
  return { mode: '', n: 0, paths: [] };
}

// Extract the path a tool acted on, using the key the relevant tool uses.
// Read, Edit and Write carry `file_path`; Grep and Glob carry `path` or, when
// no explicit path was given, `pattern`. Returns undefined when neither key is
// present, so the caller can skip pushing anything for that entry.
function extractPath(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  if (typeof input.file_path === 'string' && input.file_path) return input.file_path;
  if (typeof input.path === 'string' && input.path) return input.path;
  if (typeof input.pattern === 'string' && input.pattern) return input.pattern;
  return undefined;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  // Never nudge inside a subagent: quick-read reads a lot by design and has no
  // Agent tool, so the advice would be noise it cannot act on.
  // Caveat: agent_type is also set for a main thread started with
  // `claude --agent`, so the nudge is silent in that mode. Accepted, to keep
  // this a one-line check.
  if (input.agent_type) return;

  const tool = input.tool_name || '';
  const session = input.session_id || 'unknown';
  const safeId = session.replace(/[^a-zA-Z0-9_-]/g, '_');

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));
  pruneStale(STATE_DIR, PRUNE_RULES);
  const stateFile = path.join(STATE_DIR, `${safeId}.streak`);

  let mode;
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') mode = 'R';
  else if (tool === 'Edit' || tool === 'Write') mode = 'W';
  else {
    // Anything else breaks both streaks. This is what makes the counts
    // "consecutive" rather than "cumulative for the whole session".
    quiet(() => fs.unlinkSync(stateFile));
    return;
  }

  const streak = readStreak(stateFile);
  const count = streak.mode === mode ? streak.n + 1 : 1;
  const paths = streak.mode === mode ? streak.paths.slice() : [];
  const p = extractPath(input.tool_input);
  if (p) paths.push(p);
  quiet(() => atomicWrite(stateFile, JSON.stringify({ mode, n: count, paths: paths.slice(-20) })));

  let msg = '';
  if (mode === 'R') {
    // scattered is the safe default: its advice (hand the search to quick-read)
    // is never actively wrong, whereas same-file advises against delegating and
    // would be the harmful thing to say by accident.
    const shape = quiet(() => classifyReadPattern(paths)) ?? 'scattered';
    const advice = {
      'same-file': `[dev-agents] You have read ${count} files in a row and the same file keeps coming back. Re-reading one file means the answer is not in the file, it is in the reasoning about it. Delegation will not help here; either read the whole file once and hold it, or hand the actual question to dev-agents:deepthink.`,
      'same-dir': `[dev-agents] You have read ${count} files in a row, all from one directory. That is a survey, and a survey is exactly what dev-agents:quick-read is for: it runs on haiku, its context absorbs the file bodies, and only the conclusion comes back. Brief it with the directory and the question, not the file list.`,
      scattered: `[dev-agents] You have read ${count} files in a row, spread across unrelated directories. That is a search, not a read. Hand it to dev-agents:quick-read with the thing you are looking for, and let the file dumps stay in its context instead of yours.`,
    }[shape];
    if (count === READ_THRESHOLD || (count > READ_THRESHOLD && count % READ_REPEAT === 0)) {
      msg = advice;
    }
  } else {
    if (count === WRITE_THRESHOLD) {
      msg = `This thread has made ${count} file edits in a row on the main model. If the REMAINING work is code you have already decided how to write, hand it over rather than typing it here: quick-io (sonnet) for changes that follow a rule you can state, or the matching role agent (backend-dev, frontend-dev, test-engineer, devops-engineer) for a scoped chunk. Brief them with the DECISION, not the finished code, otherwise the brief costs as much as writing it. If the remaining edits still need judgement call by call, keep going here; that is a legitimate answer.`;
    } else if (count > WRITE_THRESHOLD && count % WRITE_REPEAT === 0) {
      msg = `Still editing inline (${count} consecutive edits on the main model). Worth one more check: is any of what is left mechanical enough to specify and hand to quick-io or a role agent?`;
    }
  }

  if (!msg) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: msg,
      },
    }) + '\n'
  );
}

main().catch(() => process.exit(0));
