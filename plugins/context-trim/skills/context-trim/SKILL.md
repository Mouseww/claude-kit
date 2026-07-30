---
name: context-trim
description: Explains what the context-trim hooks do and how to tune them. Read this when command output looks truncated and you want to know why, when a truncation notice appears in a tool result, when you want to change the truncation thresholds, or when you want to see whether delegating to subagents is actually saving money (report-metrics.mjs). Not needed for normal work; the hooks run on their own.
---

# context-trim

Two hooks that run automatically. There is nothing to remember and no prompting involved, which is the point: this plugin does not rely on the model choosing to cooperate.

Both are single node scripts (`.mjs`), so macOS, Linux and native Windows run the exact same code. The only requirement is `node` on `PATH`. There is no `.sh`/`.ps1` pair to keep in sync any more.

## truncate-verbose-output

Registered on `PostToolUse` for `Bash`, `PowerShell` and `mcp__workspace__bash`. When command output exceeds `MAX_CHARS` it replaces the result with a head/tail slice cut by **character budget**, and prepends a notice saying what happened.

When the output looks like a failure it switches strategy: it keeps the lines around the error keywords **and forces the last lines to survive**, because a test run's verdict is at the end.

Measured on the regression suite:

| Input | After | Saved |
|---|---|---|
| 200 lines x 500 chars, long-line log | 101,889 -> 3,700 | 97% |
| 300 lines x 300 chars | 92,589 -> 4,449 | 96% |
| single 40,000-char line | -> 4,635 | 89% |
| 200 FAILED lines, tail summary kept | 17,418 -> 3,115 | 83% |

Tunables at the top of `scripts/truncate-verbose-output.mjs`:

| Parameter | Default | Effect |
|---|---|---|
| `OUTPUT_SHAPE` | `object` | Shape of `updatedToolOutput`. See below |
| `MAX_CHARS` | 6000 | Below this, pass through untouched |
| `HEAD_BUDGET` | 2000 | Chars kept from the start (clean output) |
| `TAIL_BUDGET` | 2500 | Chars kept from the end (clean output) |
| `ERR_BUDGET` | 3000 | Chars for error context (failure output) |
| `TAIL_KEEP_LINES` | 25 | Lines kept from the end (failure output) |
| `TAIL_KEEP_CHARS` | 2500 | Char cap on those tail lines, whichever hits first |
| `MIN_SAVING_PCT` | 20 | Must save at least this much, or pass through |

### Three invariants

Marked A / B / C in the code. Keep them whatever else changes:

- **A. Save at least `MIN_SAVING_PCT` before replacing.** Checking only "did it get shorter" is not enough; without a percentage floor it would throw away 600 lines to save 19 characters.
- **B. Pass through when the body came back empty.** Any bug in the slicing path that produces an empty body would otherwise replace the whole tool output with a one-line notice and silently destroy it. (This invariant predates the node port, where it guarded against a missing or crashing `awk`; it is cheap and still the correct last line of defence.)
- **C. The notice must describe the path actually taken.** Otherwise you get "kept the last 25 lines" printed above a blind character cut.

### If truncation seems to do nothing

The docs say `updatedToolOutput` "replaces the tool's result" and "works for any tool", but do not state whether the replacement must match the tool's own output shape. Bash's `tool_response` is an object (`stdout`, `stderr`, `interrupted`, `isImage`), not a string. If Claude Code validates the shape, a plain string is silently discarded and you would never notice.

Both forms are implemented. `OUTPUT_SHAPE` defaults to `'object'`, the conservative reading. To check: run `seq 1 5000`. If the result starts with `[context-trim` the hook works; if you see all 5000 lines, set `OUTPUT_SHAPE = 'string'` and retry.

## measure-subagent

Registered on `SubagentStart`, `SubagentStop`, and `PostToolUse` for the `Agent` tool. Appends one JSON line per event to `~/.claude/context-offload-metrics.jsonl`.

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/report-metrics.mjs"
```

The report answers three things that are otherwise invisible:

1. **Which subagents never got used.** Zero invocations after a week means dead weight in the always-resident agent list.
2. **How much context each delegation handed back.** `returned_chars` is the direct cost of delegating. An agent routinely returning 4000+ chars is not distilling anything.
3. **Whether role agents delegate down to `dev-agents:quick-read` at all.** If they never do, the prompt text asking them to is pure waste.

Real token usage comes from the `Agent` tool's PostToolUse telemetry, so the numbers are actual usage rather than a proxy. Field names vary by version; the report probes the common spellings and tells you what to do if it shows `tokens=0`.

Do not add `transcript_path` parsing. The docs say the transcript is written asynchronously and may lag the current turn, so reading it from a hook is unreliable.

## What this plugin does not do

It does not change which model writes your code. Truncation is orthogonal to model choice: a 100k-character build log floods the context on any tier. For getting implementation onto a cheaper model, use `/model opusplan`. See the `dev-agents` plugin for the delegation side, and read its honest assessment of what delegation can and cannot deliver.
