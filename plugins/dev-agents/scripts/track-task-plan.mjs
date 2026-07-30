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

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  // Guard on the tool name as well as the hooks.json matcher.
  if (input.tool_name !== 'TaskCreate') return;

  // Sanitize before using the session id in a filename. The bash original
  // interpolated it raw, so an id containing a path separator would have
  // written outside the state directory.
  const session = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));

  // Sweep flags from sessions that ended long ago; nothing else deletes them.
  quiet(() => {
    const cutoff = Date.now() - STALE_MS;
    for (const name of fs.readdirSync(STATE_DIR)) {
      if (!name.startsWith('has-plan-') && !name.startsWith('nudged-')) continue;
      const p = path.join(STATE_DIR, name);
      quiet(() => {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      });
    }
  });

  quiet(() => fs.writeFileSync(path.join(STATE_DIR, `has-plan-${session}.flag`), '1'));

  // A plan now exists, so reset the nudge counter. If the plan is later
  // abandoned and a fresh multi-step task starts without one, the reminder
  // should come back rather than stay permanently silenced.
  quiet(() => fs.unlinkSync(path.join(STATE_DIR, `nudged-${session}.count`)));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
