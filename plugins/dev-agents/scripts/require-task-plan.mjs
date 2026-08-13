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
// VERIFIED TO FIRE (2026-08-05)
// ============================================================================
// The bash original emitted `additionalContext` under a PreToolUse
// hookSpecificOutput. That field is only documented for UserPromptSubmit and
// PostToolUse, so this was long marked unverified. It has now been confirmed in
// a real session: dispatching a subagent with no task plan injected the
// reminder text into the main thread. If a future Claude Code version regresses,
// re-check the same way (no plan, dispatch any subagent, look for the reminder)
// and fall back per the note at the bottom.
//
// Known small noise: several Agent calls issued in ONE message each run this
// hook before any of them can bump the shared counter, so a parallel dispatch
// can inject the same reminder more than once. Harmless, but a per-message
// dedupe would be the fix if it starts to grate.
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

// ---- background-dispatch reminder ------------------------------------------
// A user message that arrives while a foreground tool call is in flight kills
// that call (stoppedByUser: true). A background dispatch survives, but only if
// the model actually says so out loud, in this turn, so the user does not sit
// there waiting for a call that already keeps running without them.
const BACKGROUND_MESSAGE =
  '[dev-agents] This subagent is being dispatched in the background (run_in_background: true). ' +
  'Say so explicitly in this same turn: tell the user it is running in the background and that ' +
  'anything they type next will not stop it. Do not end the turn with only a line like ' +
  '"I will continue once it finishes" without stating that explicitly.';

// ---- unbounded foreground-dispatch reminder --------------------------------
// Claude Code interrupts an in-flight foreground tool call the moment a new
// user message is queued, and the killed subagent comes back as
// stoppedByUser: true. Two measured cases: fleet-evaluator ran 13 minutes,
// an unbounded "Explore" brief ran 65 minutes. Users do not wait quietly that
// long, so an unbounded foreground brief is a bug waiting to happen even
// though nothing here is technically wrong.
const UNBOUNDED_MARKERS = [
  'very thorough',
  'exhaustive',
  'exhaustively',
  'entire codebase',
  'whole codebase',
  'all files',
  'every file',
  '整个代码库',
  '全部文件',
  '逐个',
  '穷尽',
];
const UNBOUNDED_AGENT = 'fleet-engineering:fleet-evaluator';

function unboundedMatch(toolInput) {
  if (toolInput?.subagent_type === UNBOUNDED_AGENT) {
    return `${UNBOUNDED_AGENT} (measured 13 minutes)`;
  }
  const haystacks = [toolInput?.prompt, toolInput?.description].filter((s) => typeof s === 'string');
  for (const text of haystacks) {
    const lower = text.toLowerCase();
    for (const marker of UNBOUNDED_MARKERS) {
      if (lower.includes(marker.toLowerCase())) return marker;
    }
  }
  return null;
}

function unboundedMessage(matched) {
  return (
    `[dev-agents] This foreground dispatch matched "${matched}", an unbounded scope. ` +
    'Claude Code interrupts an in-flight foreground tool call the moment the user sends the next ' +
    'message, and a brief this size has measured out at 10+ minutes; the user will not wait quietly ' +
    'that long. Split it into bounded dispatches instead, each with an explicit file list or one ' +
    'concrete question, or pass `run_in_background: true` and tell the user in this same turn that ' +
    'it is running in the background.'
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let timer = null;
    const IDLE_MS = 5000;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve(buf), IDLE_MS);
      timer.unref();
    };
    process.stdin.setEncoding('utf8');
    resetTimer();
    process.stdin.on('data', (c) => {
      buf += c;
      resetTimer();
    });
    process.stdin.on('end', () => {
      if (timer) clearTimeout(timer);
      resolve(buf);
    });
    process.stdin.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve(buf);
    });
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

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));

  const parts = [];
  const toolInput = input.tool_input || {};
  const isBackground = toolInput.run_in_background === true;

  // Background-dispatch reminder: independent of the plan check below, at most
  // once per session.
  const bgFlag = path.join(STATE_DIR, `bg-warned-${session}.flag`);
  if (isBackground && !fs.existsSync(bgFlag)) {
    quiet(() => fs.writeFileSync(bgFlag, '1'));
    parts.push(BACKGROUND_MESSAGE);
  }

  // Unbounded foreground-dispatch reminder: only applies when not background,
  // at most once per session.
  if (!isBackground) {
    const matched = unboundedMatch(toolInput);
    const unboundedFlag = path.join(STATE_DIR, `unbounded-warned-${session}.flag`);
    if (matched && !fs.existsSync(unboundedFlag)) {
      quiet(() => fs.writeFileSync(unboundedFlag, '1'));
      parts.push(unboundedMessage(matched));
    }
  }

  // A plan exists: skip the plan reminder, but still emit anything collected above.
  if (!fs.existsSync(path.join(STATE_DIR, `has-plan-${session}.flag`))) {
    const countFile = path.join(STATE_DIR, `nudged-${session}.count`);

    const saved = quiet(() => fs.readFileSync(countFile, 'utf8').trim());
    const seen = saved && /^\d+$/.test(saved) ? Number(saved) : 0;
    const n = seen + 1;
    quiet(() => fs.writeFileSync(countFile, String(n)));

    // Fire on the first planless dispatch, then every REPEAT_EVERY after it.
    if (n === 1 || n % REPEAT_EVERY === 0) parts.push(MESSAGE);
  }

  if (parts.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: parts.join('\n\n'),
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
