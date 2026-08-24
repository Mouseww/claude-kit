---
description: Install or update the concrete-answers reporting block in a CLAUDE.md
argument-hint: "user | project | <path to CLAUDE.md>"
allowed-tools: Bash(node:*), Read
---

Install or update the always-resident reporting block in a `CLAUDE.md`.

Target (default `project` if empty): `$ARGUMENTS`

Why this exists: the rule this pack enforces has to apply to every answer, and a
skill body only enters context when the skill is invoked. So the four rules live
in the block, which is resident on every turn, and the reasoning stays in the
`concrete-answers` skill.

Steps:

1. Preview first, always:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/../../scripts/sync-claude-md.mjs" --plugin concrete-answers --target <target> --dry-run
   ```

2. Show the user the diff and the action list it prints.

3. On confirmation, run the same command without `--dry-run`. It writes a
   timestamped `.bak` first and prints the path.

4. Tell them the block only takes effect in **new** sessions, and where the
   backup is.

Only bytes between the `BEGIN concrete-answers`/`END concrete-answers` markers
are touched; line endings, BOM and everything else in the file are passed
through unchanged. `--remove` takes the block back out.
