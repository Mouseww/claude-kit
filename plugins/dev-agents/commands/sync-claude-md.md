---
description: Install or update the dev-agents delegation block in a CLAUDE.md
argument-hint: "user | project | <path to CLAUDE.md>"
allowed-tools: Bash(node:*), Read
---

Install or update the always-resident delegation block in a `CLAUDE.md`.

Target (default `project` if empty): `$ARGUMENTS`

Why this exists: a skill body only enters context when the skill is invoked, but
a `CLAUDE.md` block is resident on every turn. The guidance that should change
behaviour by default belongs in the block; the long reference stays in the
`dev-agents` skill. The block is a real recurring token cost, so it is kept short
on purpose.

Steps:

1. Preview first, always:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-claude-md.mjs" --target <target> --dry-run
   ```

2. Show the user the diff and the action list it prints. Call out explicitly if
   it reports replacing a **superseded** block — that means an older
   `context-offload` block was found and is being retired, which is a change to
   instructions they have been running with.

3. On confirmation, run the same command without `--dry-run`. It writes a
   timestamped `.bak` first and prints the path.

4. Tell them the block only takes effect in **new** sessions, and where the
   backup is.

Guarantees worth repeating to the user if they hesitate:

- Only bytes between the `BEGIN`/`END` markers are touched. Everything else in
  the file, including its line endings and whether it ends with a newline, is
  passed through unchanged.
- If the markers are unbalanced, the script refuses to write rather than guess.
- `--remove` takes the block back out and leaves the rest of the file alone.

A SessionStart hook also runs this script with `--heal` at the start of every
session. If a block installed by an earlier version of this pack is already in
a CLAUDE.md, an update to it is applied automatically (with the same
timestamped `.bak`); this command is only needed to install the block the
first time, to change its target, or to remove it.
