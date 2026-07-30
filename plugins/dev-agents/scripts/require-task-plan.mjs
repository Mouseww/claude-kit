#!/usr/bin/env node
// PreToolUse hook (matcher: Agent) for the dev-agents plugin.
//
// Half of a pair with track-task-plan.mjs. Before the main thread dispatches a
// subagent, check whether a task plan exists. If not, remind it to build one
// first, because a long-running subagent can outlive the conversation history
// that holds an unwritten plan.
//
// This is a reminder, not a block. It never denies the tool call.
//
// ============================================================================
// VERIFY THIS ACTUALLY FIRES
// ============================================================================
// The bash original emitted `additionalContext` under a PreToolUse
// hookSpecificOutput. That field is documented for UserPromptSubmit and
// PostToolUse; whether this Claude Code version honours it on PreToolUse is not
// something the script can detect, and a silently ignored payload looks exactly
// like a working hook from here.
//
// To check, in a session with dev-agents loaded: with no task plan created,
// dispatch any subagent. If the reminder text appears, it works. If it does not,
// this hook is inert -- see the note at the bottom for the fallback.
// ============================================================================
//
// Two deviations from the bash original, both deliberate:
//
//   1. The session id is sanitized before being used in a filename. The original
//      interpolated it raw.
//   2. The reminder is throttled. The original fired on EVERY Agent dispatch
//      that lacked a plan, so a genuinely single-step delegation got nagged
//      every single time. It now fires on the first dispatch and then every
//      REPEAT_EVERY after that, which keeps pressure on real multi-step work
//      without shouting at one-shot handoffs. Set REPEAT_EVERY to 1 to restore
//      the original behaviour.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- tunables --------------------------------------------------------------
const REPEAT_EVERY = 3; // after the first reminder, nudge every Nth planless dispatch
// -----------------------------------------------------------------------------

const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

const MESSAGE =
  '[dev-agents] You are about to dispatch a subagent, but no task plan has been created yet. ' +
  'When a subagent runs for a long time, context compression may discard your earlier plan from ' +
  'the conversation, causing you to lose track of remaining steps after the subagent returns. ' +
  'Create a task plan first, with a task per step describing the work and its expected output, ' +
  'and mark each one completed as you finish it. This keeps a multi-step plan persistent and ' +
  'visible even after long subagent executions. If this really is a single self-contained ' +
  'delegation, ignore this and continue.';

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
  if (input.tool_name !== 'Agent') return;

  // Never fire inside a subagent: nested delegation (a role agent spawning
  // quick-read) is expected and should not be interrupted.
  // Caveat: agent_type is also set for a main thread started with
  // `claude --agent`, so the reminder is silent in that mode.
  if (input.agent_type) return;

  const session = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

  // A plan exists: nothing to say.
  if (fs.existsSync(path.join(STATE_DIR, `has-plan-${session}.flag`))) return;

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));
  const countFile = path.join(STATE_DIR, `nudged-${session}.count`);

  const saved = quiet(() => fs.readFileSync(countFile, 'utf8').trim());
  const seen = saved && /^\d+$/.test(saved) ? Number(saved) : 0;
  const n = seen + 1;
  quiet(() => fs.writeFileSync(countFile, String(n)));

  // Fire on the first planless dispatch, then every REPEAT_EVERY after it.
  if (n !== 1 && n % REPEAT_EVERY !== 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: MESSAGE,
      },
    }) + '\n'
  );
}

main().catch(() => process.exit(0));

// Fallback if additionalContext turns out to be ignored on PreToolUse: move this
// hook to PostToolUse on TodoWrite/Task-adjacent tools, or fold the reminder into
// the dev-agents skill text, which the model reads before deciding to delegate.
// Do not switch it to permissionDecision: "deny". Blocking a dispatch over a
// missing task list trades a small loss of context for a hard failure, and the
// hook cannot tell a one-step delegation from a ten-step one.
