---
description: List the plugins this claude-kit marketplace offers and what each contains
allowed-tools: Bash(node:*), Read, Glob
---

Show what is in this claude-kit repository.

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/../../scripts/enable-in-project.mjs" --list
```

Then present the result as a short table: plugin name, one-line description, and
what it ships (skills / agents / commands / hooks). Keep it to one screen; do not
paste the raw JSON.
