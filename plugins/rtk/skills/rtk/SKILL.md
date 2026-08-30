---
name: rtk
description: Explains what the rtk pack rewrites before a Bash command runs, when that rewrite is harmful and should be bypassed, and how it divides work with the context-trim pack. Read this when a Bash command returned a digest instead of the output you expected, when you need the raw untouched output of a command, or when deciding whether rtk is worth enabling on a given repo.
---

# rtk

This pack wires the external `rtk` binary into a **PreToolUse** hook. Before a
`Bash` command runs, `rtk hook claude` gets a chance to rewrite it into a
cheaper equivalent — `git log` becomes a digest, `ls -R` becomes a summarized
tree, `cargo test` becomes a pass/fail roll-up instead of thousands of lines.

The rewrite happens **before execution**. You are not reading a truncated
version of the real output; you are reading the output of a different, smaller
command that rtk decided was equivalent for your purposes.

That distinction is the whole reason this skill exists.

## When the rewrite is wrong, and what to do

rtk optimizes for "the agent wants to know the shape of this output." It is
wrong whenever you actually need the literal bytes:

- **Reproducing an exact error.** A digest of a test failure is not the failure.
  If you are quoting an error back to the user or matching it against a known
  string, get the raw output.
- **Counting or diffing.** `git log` summarized is not `git log` counted. Any
  time your next step is "how many" or "compare these two runs", the digest has
  already thrown away what you needed.
- **Anything whose output you will parse.** Scripts and `--porcelain`/`--json`
  invocations exist to be machine-read. A rewritten version may not be.
- **Verifying a claim.** If you are checking whether something is true — a file
  exists, a test really passed, a string is absent — a summary is evidence of
  the summarizer's opinion, not of the fact.

To bypass it for a single call, set the escape hatch in the command itself:

```bash
CLAUDE_KIT_RTK_OFF=1 git log --oneline -20
```

The wrapper checks `CLAUDE_KIT_RTK_OFF` before it does anything else, so this
turns the rewrite off for that one invocation without touching config.

To turn it off for the session, disable the `rtk` plugin. Because this pack
owns its own hook rather than using upstream's global installer, disabling the
plugin genuinely disables the behavior — there is nothing left behind in
`~/.claude/settings.json` to keep firing.

## Division of labor with context-trim

These two packs are often confused for each other. They act at different points
and neither replaces the other:

| | when it acts | what it does |
|---|---|---|
| `rtk` | PreToolUse, before the command runs | swaps the command for a cheaper one |
| `context-trim` | PostToolUse, after output exists | truncates output that is already huge or failing |

Running both is fine and is the intended configuration. rtk removes the bulk,
and `truncate-verbose-output.mjs` still catches whatever slips through — a
command rtk has no rule for, or output that is large for reasons rtk could not
predict. The `measure-subagent.mjs` half of context-trim tracks subagent cost
and has nothing to do with rtk at all.

## What this pack deliberately does not do

Upstream ships `rtk init -g`, which writes rtk's hook into your **global**
`~/.claude/settings.json`, drops a `~/.claude/RTK.md`, and appends an
`@RTK.md` reference to your **global** `~/.claude/CLAUDE.md`.

This pack does not run that, and you should not run it on top of this pack.
Three reasons:

1. None of those edits are undone by disabling a plugin. You would be left with
   a hook firing on every Bash call from a plugin you thought was off.
2. Your global `CLAUDE.md` is hand-maintained. An installer appending to it is
   an edit you did not review, in the file that governs every project.
3. It would double up: upstream's global hook and this pack's hook would both
   fire on the same call.

## Failure behavior

Every failure path in `scripts/rtk-rewrite.mjs` passes the command through
unchanged. Missing binary, spawn error, timeout, malformed output from rtk — all
of them produce empty stdout, which Claude Code reads as "no opinion, run it as
written." The wrapper never emits a `deny`. If rtk is not installed, the plugin
is inert rather than broken, and it stays silent rather than warning on every
call.

## Scope: Bash only

The hook matches `Bash` and not `PowerShell`. rtk's rewrite rules assume POSIX
command syntax, and a rewrite that is correct for `ls -R` is not correct for
`Get-ChildItem -Recurse`. On a machine where PowerShell is the primary shell,
that restriction is what keeps rtk from corrupting commands it does not
understand.
