---
description: Replace this. One line, imperative, shown in the slash-command list.
argument-hint: "<what to pass>"
allowed-tools: Read, Grep, Glob
---

This file's body is the prompt. It becomes `/<plugin-name>:example-command`, so
rename the file to the command you want.

Arguments arrive as `$ARGUMENTS`. Use `$1`, `$2` for positional access.

Requested: `$ARGUMENTS`

Write the instructions as a numbered procedure. Two things to get right:

1. **Narrow `allowed-tools`.** It is the command's blast radius. Prefer
   `Bash(node:*)` over `Bash`, and drop `Write`/`Edit` from anything read-only.
2. **Say what to do when the input is missing or wrong.** A command whose first
   step assumes a well-formed argument fails in a confusing way.

Reference files inside this plugin with `${CLAUDE_PLUGIN_ROOT}`, and the
repository root with `${CLAUDE_PLUGIN_ROOT}/../..`.
