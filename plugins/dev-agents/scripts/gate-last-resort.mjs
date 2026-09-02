#!/usr/bin/env node
// PreToolUse hook (matcher: Agent) for the dev-agents plugin.
//
// last-resort runs on the fable model tier and is a deliberate last resort for
// a problem an opus-tier agent already failed to solve. An accidental dispatch
// is the most expensive mistake this pack can make, so this hook fires a
// reminder every time that agent is about to be dispatched, asking the model
// to confirm out loud that the dispatch is actually warranted.
//
// This is a reminder, not a block. It never denies the tool call and always
// exits 0.
//
// Unlike require-task-plan.mjs, this hook is deliberately unthrottled and
// keeps no state at all: a last-resort dispatch is rare by definition, so
// every single occurrence earns the full message, and there is nothing worth
// remembering between calls. No STATE_DIR is created or read.
//
// The agent id is matched with a case-insensitive substring test against
// tool_input.subagent_type, so both the bare `last-resort` and the namespaced
// `dev-agents:last-resort` trigger it.

const MESSAGE =
  '[dev-agents] last-resort runs on the fable tier and exists for a problem an opus-tier agent has ' +
  'already failed to solve. Before this call is worth its cost, confirm all four in this turn, out ' +
  'loud, to the user: (1) a cheaper agent actually attempted it and you can say what it concluded, ' +
  '(2) the failure is a real observed behaviour, not an inference from reading code, (3) the brief ' +
  'you are about to send lists what was already tried and ruled out, so this agent does not repeat ' +
  'it, (4) the blocker is reasoning, not missing context that a quick-read could simply fetch. If ' +
  'any of the four is no, that is the cheaper next step, not this. If all four hold, say so and ' +
  'dispatch.';

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

async function main() {
  const raw = await readStdin();
  let input;
  input = quiet(() => JSON.parse(raw));
  if (!input) return;

  if (input.tool_name !== 'Agent') return;

  // Never fire inside a subagent: nested delegation is expected.
  if (input.agent_type) return;

  const subagentType = input.tool_input?.subagent_type;
  if (typeof subagentType !== 'string') return;
  if (!subagentType.toLowerCase().includes('last-resort')) return;

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
