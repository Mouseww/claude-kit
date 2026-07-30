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
// State: one file per session under the temp dir holding "<MODE>:<count>".
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
const STALE_MS = 24 * 60 * 60 * 1000;

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      buf += c;
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
  });
}

function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function sweepStale() {
  quiet(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const name of fs.readdirSync(STATE_DIR)) {
      if (!/\.(streak|count)$/.test(name)) continue;
      const p = path.join(STATE_DIR, name);
      quiet(() => {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      });
    }
  });
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
  sweepStale();
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

  let prevMode = '';
  let count = 0;
  const saved = quiet(() => fs.readFileSync(stateFile, 'utf8').trim());
  if (saved) {
    const idx = saved.indexOf(':');
    if (idx >= 0) {
      prevMode = saved.slice(0, idx);
      const n = saved.slice(idx + 1);
      count = /^\d+$/.test(n) ? Number(n) : 0;
    }
  }

  count = prevMode === mode ? count + 1 : 1;
  quiet(() => fs.writeFileSync(stateFile, `${mode}:${count}`));

  let msg = '';
  if (mode === 'R') {
    if (count === READ_THRESHOLD) {
      msg = `This thread has made ${count} read-only lookups (Read/Grep/Glob) in a row without doing anything else. If open-ended exploration remains, delegate it to quick-read instead of continuing inline. It keeps the raw output in its own context and returns only the conclusion.`;
    } else if (count > READ_THRESHOLD && count % READ_REPEAT === 0) {
      msg = `Still reading inline (${count} consecutive lookups). If the remaining exploration is self-contained, quick-read would keep this context smaller.`;
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
