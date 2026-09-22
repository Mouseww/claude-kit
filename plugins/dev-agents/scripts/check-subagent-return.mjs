#!/usr/bin/env node
// PostToolUse hook (matcher: Agent) for the dev-agents plugin.
//
// This is a reminder, not a block. It never denies the tool call and always
// exits 0.
//
// It is the post-return counterpart to require-task-plan.mjs. That hook warns
// BEFORE a subagent is dispatched, when no task plan exists yet. Nothing in
// the pack checked what came BACK from the dispatch. This one does: it looks
// at the returned tool_response and flags a background-dispatch acknowledgement,
// an outright failure, or a suspiciously thin result.
//
// The exact tool_response shape (a string, an array of content blocks, an
// object with a .content field, or something else entirely) is version
// dependent, the same caveat measure-subagent.mjs documents for
// last_assistant_message. Every shape is probed defensively rather than
// assumed.
//
// Tunables are at the top of the file: THIN_CHARS and REPEAT_EVERY.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- tunables --------------------------------------------------------------
const THIN_CHARS = 80; // a returned result shorter than this looks suspicious
const REPEAT_EVERY = 3; // after the first thin-result nudge, repeat every Nth
// -----------------------------------------------------------------------------

const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

// A background dispatch returns a long, confident-looking acknowledgement
// ("Async agent launched successfully...", measured at 1134 characters), so it
// trips neither the failure branch nor the thin-result branch. This reminder is
// the only thing standing between that acknowledgement and a caller who reads
// it as a finished result and redoes the work itself.
//
// It therefore fires on EVERY background dispatch, with no throttle. An earlier
// version wrote a once-per-session flag, on the theory that the caller learns
// the rule after being told once. It does not, for two reasons. A parallel
// batch (eight background dispatches in one message is normal usage here) runs
// eight copies of this hook at the same time racing for one flag, so exactly
// one of the eight got the reminder and the other seven were silently waved
// through. And the reminder is not a general lesson: it is a claim about one
// specific dispatch that has not come back yet, so it has to be attached to
// that dispatch to mean anything.
//
// `label` names which dispatch this is about, because in a parallel batch the
// acknowledgements are otherwise indistinguishable from one another. The
// acknowledgement's own agentId is deliberately NOT included: the harness marks
// it internal metadata that must not be echoed.
function backgroundAck(label) {
  return (
    '[dev-agents] ' +
    label +
    ' was a background dispatch, so what you just received is an acknowledgement, ' +
    'not the result. Do not report the task as done and do not summarize findings from it yet. ' +
    'Carry on with work that does not depend on it, and read the real output with TaskOutput before ' +
    'making any claim about what it found. If several dispatches went out together, each one needs ' +
    'its own output read; one returning tells you nothing about the others.'
  );
}

// Fallback for a harness that backgrounds without an explicit
// run_in_background flag in tool_input (the Agent tool documents backgrounding
// as its default, and a default does not have to be spelled out in the call).
// Where that happens the flag check below sees nothing, so match the
// acknowledgement text itself. Phrasing is version dependent, hence several
// independent anchors rather than one exact string.
const BACKGROUND_ACK_PATTERN =
  /async agent launched|agent is working in the background|running in the background|notified automatically when it completes/;

// Name the dispatch without dragging its whole brief into the caller's context.
function dispatchLabel(toolInput) {
  const agent = typeof toolInput?.subagent_type === 'string' ? toolInput.subagent_type.trim() : '';
  const desc = typeof toolInput?.description === 'string' ? toolInput.description.trim() : '';
  const short = desc.replace(/\s+/g, ' ').slice(0, 60);
  if (agent && short) return `The \`${agent}\` dispatch ("${short}")`;
  if (agent) return `The \`${agent}\` dispatch`;
  if (short) return `The dispatch "${short}"`;
  return 'That dispatch';
}

function failedMessage(reason) {
  return (
    '[dev-agents] The subagent you just dispatched came back with ' +
    reason +
    '. That is a failure, not work still in progress. Do not redispatch the same brief unchanged; ' +
    'it gets killed the same way. Tell the user what happened first, then either narrow it into a ' +
    'bounded dispatch, pass run_in_background: true, or finish the work inline yourself. Do not ' +
    'report the underlying task as done, and do not build on a result you never received.'
  );
}

function thinMessage(n) {
  return (
    '[dev-agents] That subagent returned only ' +
    n +
    ' characters. Check that it actually did the work before you build on it: a near-empty return ' +
    'usually means the brief was blocked, by a file it could not find, a command that hung or was ' +
    'denied, or a scope it declined, rather than there being nothing to say. Verify the specific ' +
    'fact you need, or redispatch with the missing context supplied.'
  );
}

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

// A content block is either a plain string or an object carrying a .text
// field (or something else that stringifies). Extract the text either way.
function blockText(b) {
  if (b == null) return '';
  if (typeof b === 'object') return b.text == null ? '' : String(b.text);
  return String(b);
}

// tool_response field names are version dependent: it may be undefined/null,
// a plain string, an array of content blocks, an object with a .content that
// is itself a string or an array of blocks, or some other object entirely.
// Extract the readable text defensively, and separately return the response
// object itself so its flags can still be inspected even when no text comes
// out of it.
function extractText(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map(blockText).join('');
  if (typeof r === 'object') {
    const c = r.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(blockText).join('');
    return '';
  }
  return '';
}

const FAILURE_FLAGS = ['interrupted', 'stoppedByUser', 'toolDenialKind', 'is_error', 'error'];

const INTERRUPTION_PATTERN =
  /tool execution was interrupted|was interrupted by|stopped by (the )?user|user (stopped|aborted|interrupted)/;

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  if (input.tool_name !== 'Agent') return;

  // Never fire inside a subagent: nested delegation is expected.
  if (input.agent_type) return;

  const session = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));

  const r = input.tool_response;
  const text = extractText(r);

  // Branch A: background acknowledgement. Checked first, and when it applies
  // it is the only message emitted. Unthrottled by design; see backgroundAck.
  const toolInput = input.tool_input || {};
  const isBackground =
    toolInput.run_in_background === true || BACKGROUND_ACK_PATTERN.test(text.toLowerCase());
  if (isBackground) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: backgroundAck(dispatchLabel(toolInput)),
        },
      }) + '\n'
    );
    return;
  }

  // Branch B: failure. No throttle; a failed dispatch always matters.
  let reason = null;
  if (r === null || r === undefined) {
    reason = 'a null result';
  } else if (r && typeof r === 'object') {
    for (const flagName of FAILURE_FLAGS) {
      if (r[flagName]) {
        reason = `the ${flagName} flag`;
        break;
      }
    }
  }
  if (!reason && INTERRUPTION_PATTERN.test(text.toLowerCase())) {
    reason = 'an interruption marker in the result';
  }
  if (!reason && text.trim() === '') {
    reason = 'an empty result';
  }

  if (reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: failedMessage(reason),
        },
      }) + '\n'
    );
    return;
  }

  // Branch C: thin return. Only reached when neither A nor B fired.
  if (text.length < THIN_CHARS) {
    const countFile = path.join(STATE_DIR, `thin-warned-${session}.count`);
    const saved = quiet(() => fs.readFileSync(countFile, 'utf8').trim());
    const seen = saved && /^\d+$/.test(saved) ? Number(saved) : 0;
    const n = seen + 1;
    quiet(() => atomicWrite(countFile, String(n)));

    if (n === 1 || n % REPEAT_EVERY === 0) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: thinMessage(text.length),
          },
        }) + '\n'
      );
    }
  }
}

main().catch(() => process.exit(0));
