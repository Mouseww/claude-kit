---
description: Scaffold a new capability pack (plugin) in this claude-kit repository
argument-hint: "<plugin-name> [one-line description]"
allowed-tools: Bash(node:*), Read, Write, Edit, Glob
---

Add a new capability pack to this claude-kit repository.

Requested: `$ARGUMENTS`

The repository root is `${CLAUDE_PLUGIN_ROOT}/../..`. Read `CONTRIBUTING.md` there
first — it is the authority on layout and naming; this command is only the driver.

Steps:

1. Work out the plugin name (kebab-case, matches the directory name) and a one-line
   description. Ask if either is missing from `$ARGUMENTS`.

2. Copy `templates/plugin-template/` to `plugins/<name>/`.

3. Fill in `plugins/<name>/.claude-plugin/plugin.json`: `name` must equal the
   directory name; write a real `description` (this is what the model reads when
   deciding whether the pack is relevant).

4. Delete the parts of the template the pack does not use. An empty `agents/`,
   `commands/`, `skills/` or `hooks/` directory is noise — remove it. If there are
   no hooks, also remove the `"hooks"` key from `plugin.json`.

5. Add an entry to `.claude-plugin/marketplace.json` under `plugins`, with
   `"source": "./plugins/<name>"`, the same description, and useful `tags`.

6. Run the validator and fix anything it reports:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/../../scripts/validate.mjs"
   ```

7. Summarise what was created and what the user still needs to write (the actual
   skill body / agent prompts). Do not invent capability content the user did not
   ask for.
