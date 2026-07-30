---
description: Enable claude-kit plugins for the current project by writing .claude/settings.json
argument-hint: "[plugin,plugin,...]  (omit to be asked)"
allowed-tools: Bash(node:*), Read, Glob
---

Enable one or more claude-kit plugins for **this project**, so anyone who clones
the repository gets prompted to install them.

Requested plugins (may be empty): `$ARGUMENTS`

Do this:

1. List what the marketplace offers:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/../../scripts/enable-in-project.mjs" --list
   ```

2. If `$ARGUMENTS` is empty, show that list and ask which plugins to enable.
   Otherwise use the comma-separated names given.

3. Preview the change before writing anything:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/../../scripts/enable-in-project.mjs" --project . --plugins <names> --dry-run
   ```

   Show the user the diff it prints.

4. On confirmation, run the same command without `--dry-run`. The script deep-merges
   into any existing `.claude/settings.json` and writes a `.bak` first.

5. Tell the user to run `/plugin` (or restart the session) so Claude Code picks up
   the newly enabled plugins, and remind them to commit `.claude/settings.json`.

Notes:

- Default marketplace source is the local repository directory. If the team pulls
  claude-kit from a remote instead, pass `--source git --url <repo-url>`.
- The script never removes keys it did not add. To disable a plugin, edit
  `enabledPlugins` in `.claude/settings.json` by hand or pass `--remove`.
