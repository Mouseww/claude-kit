---
name: nesting-discipline
description: Rules for subagents that spawn nested subagents via the Agent tool
---

When you call the Agent tool, ALWAYS set `run_in_background: false`.
Do not end your turn while any agent you dispatched has not returned.
If a nested agent returns null or fails, state what was not completed
in your `## Incomplete` section instead of describing it as pending.
