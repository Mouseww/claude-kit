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

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // rule 2
  }

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
