---
name: context-trim
description: Explains what the context-trim hooks do and how to tune them. Read this when command output looks truncated and you want to know why, when a truncation notice appears in a tool result, when a large result came back whole and you expected it to be trimmed, when a "left intact" tip suggests using Read or Grep instead, when you want to change the truncation thresholds, or when you want to see whether delegating to subagents is actually saving money (report-metrics.mjs). Not needed for normal work; the hooks run on their own.
---

# context-trim

Two hooks that run automatically. There is nothing to remember and no prompting involved, which is the point: this plugin does not rely on the model choosing to cooperate.

Both are single node scripts (`.mjs`), so macOS, Linux and native Windows run the exact same code. The only requirement is `node` on `PATH`. There is no `.sh`/`.ps1` pair to keep in sync any more.

## truncate-verbose-output

Registered on `PostToolUse` for `Bash`, `PowerShell` and `mcp__workspace__bash`.

When the output looks like a **failure** it keeps the lines around the error keywords **and forces the last lines to survive**, because a test run's verdict is at the end. This is the path that earns its keep.

When the output is **clean** it is left completely alone until it passes a much higher threshold, because cutting a result the agent deliberately went and fetched is how you get it to fetch the result again. See below.

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
| `MAX_CHARS_FAILURE` | 6000 | Failure output: below this, pass through untouched |
| `MAX_CHARS_CLEAN` | 30000 | Clean output: below this, pass through untouched |
| `ADVICE_MIN_CHARS` | 6000 | Above this, untruncated output still gets a narrowing tip |
| `HEAD_BUDGET` | 2000 | Chars kept from the start (clean output) |
| `TAIL_BUDGET` | 2500 | Chars kept from the end (clean output) |
| `ERR_BUDGET` | 3000 | Chars for error context (failure output) |
| `TAIL_KEEP_LINES` | 25 | Lines kept from the end (failure output) |
| `TAIL_KEEP_CHARS` | 2500 | Char cap on those tail lines, whichever hits first |
| `MIN_SAVING_PCT` | 20 | Must save at least this much, or pass through |

### Why clean output gets a 5x higher threshold

Truncation is not free. When the slice drops the part the agent actually wanted, the agent reruns the command, and that costs the wasted slice (which stays in context forever), a fresh tool call, and the new output. Write `N` for the original size, `K` for the ~4700 chars any slice keeps, and `p` for the probability of a rerun. Truncation is a net loss when:

```
p > (N - K) / (N + K)
```

| N | Rerun rate that makes truncation a loss |
|---|---|
| 6,000 | 12% |
| 9,000 | 32% |
| 30,000 | 73% |
| 100,000 | 91% |

The break-even rate **rises** with `N`, while the real rerun rate **falls** with `N`: the middle of a huge log is usually noise, the middle of an 8k result is usually the answer. Below the crossover, truncating loses money. A single `MAX_CHARS = 6000` sat far below it.

The two modes land on opposite sides:

- **Failure output** — the agent wanted a verdict. The useful content really is clustered at the keywords and the tail, and once it has the verdict it goes to the source rather than rerunning. Low `p`, cut at 6000.
- **Clean output** — the agent ran the command to *get* the content, so the value is spread through it. High `p`, cut at 30000, the point where even a 70% rerun rate still breaks even.

Over 329 real invocations before the split, the failure path produced **76% of all savings from 74% of the truncations**. The clean path fired 5 times, saved about 6.6k tokens in total, and paid for every rerun it caused.

### The advice path

Clean output over `ADVICE_MIN_CHARS` is not truncated, but it is not ignored either. If the command was clearly aimed at retrieving content (`cat`, `grep`, `curl`, `git show`, `kubectl logs`, and the rest of the table in `classifyCommand`), the hook emits the narrowing tip on its own as `additionalContext` and leaves the tool result complete:

```
[context-trim: 11842 chars, left intact. Next time, use the Read tool instead (add offset/limit for a slice).]
```

This is the half of the plugin that changes the *next* command instead of damaging the current one, and it carries no rerun risk at all. Ordinary build and test commands get nothing, because there is no narrower way to run them.

`additionalContext` on `PostToolUse` is documented, unlike the `PreToolUse` use in `require-task-plan.mjs`. If a Claude Code version ever drops it the tip is silently lost and the output still arrives intact, which is the right way for this to fail.

### Four invariants

Marked A / B / C / D in the code. Keep them whatever else changes:

- **A. Save at least `MIN_SAVING_PCT` before replacing.** Checking only "did it get shorter" is not enough; without a percentage floor it would throw away 600 lines to save 19 characters.
- **B. Pass through when the body came back empty.** Any bug in the slicing path that produces an empty body would otherwise replace the whole tool output with a one-line notice and silently destroy it. (This invariant predates the node port, where it guarded against a missing or crashing `awk`; it is cheap and still the correct last line of defence.)
- **C. The notice must describe the path actually taken.** Otherwise you get "kept the last 25 lines" printed above a blind character cut. The advice notice is bound by the same rule in reverse: it must never claim anything was removed, or the model will go looking for content that is still in front of it.
- **D. Never character-slice a structured payload.** Half a JSON document neither parses nor answers the question, so `p` is close to 1 and the inequality above can never come out in our favour. `looksStructured` is a weak heuristic (`[2026-08-13] build started` false-positives), but it is only consulted at the character-slice decision, which is reached only when the payload has too few line breaks to slice by line. A log has line breaks, so the classic false positive never gets there.

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
