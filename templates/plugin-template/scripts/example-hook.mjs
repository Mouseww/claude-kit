#!/usr/bin/env node
// Template hook. Replace the body; keep the shape.
//
// Contract:
//   stdin  - one JSON object describing the event
//   stdout - either nothing (do not interfere) or one JSON object
//   exit   - always 0 unless you deliberately want to block the tool call
//
// Rules this repository holds hooks to:
//
//   1. Node only. No .sh, no .ps1, no jq/awk. One file runs on macOS, Linux and
//      native Windows. The validator rejects shell entry points.
//   2. Silence is the safe default. On any unexpected input, write nothing and
//      exit 0. A hook that emits something wrong on a payload it did not
//      understand is worse than one that does nothing.
//   3. Guard on tool_name inside the script, not only via the hooks.json matcher.
//      Widening the matcher later must not silently widen the behaviour.
//   4. Never let a throw escape. A crashing hook fires on every tool call.
//   5. readStdin() has two deadlines, an idle one and an absolute one; see the
//      shared:readStdin block below. Do not drop either without reading why.
//   6. Persist state, if any, through atomicWrite, never a bare writeFileSync.
//   7. Marker blocks below are shared:readStdin and shared:quiet, copied
//      byte-identical from other hooks in this repo. Keep them that way; see
//      tests/hook-helpers-consistent.test.mjs, which fails the build on any
//      drift between copies or any copy missing from HELPER_OWNERS.

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
  if (!input) return; // rule 2

  // Rule 3: keep this list in sync with the matcher in hooks/hooks.json.
  if (input.tool_name !== 'Bash') return;

  // ... your logic here. Return early whenever there is nothing to say.

  // To add context for the model:
  //
  // process.stdout.write(JSON.stringify({
  //   hookSpecificOutput: {
  //     hookEventName: 'PostToolUse',
  //     additionalContext: 'something the model should know',
  //   },
  // }) + '\n');
  //
  // To replace the tool result, use `updatedToolOutput` instead, and match the
  // shape the tool itself returned (an object with stdout/stderr for Bash, not a
  // bare string). See plugins/context-trim for a worked example.
}

main().catch(() => process.exit(0)); // rule 4
