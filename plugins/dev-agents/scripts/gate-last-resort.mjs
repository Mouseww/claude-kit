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
