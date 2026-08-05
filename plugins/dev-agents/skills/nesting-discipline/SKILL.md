---
name: nesting-discipline
description: Rules for subagents that spawn nested subagents via the Agent tool
---

When you call the Agent tool, ALWAYS set `run_in_background: false`.
Do not end your turn while any agent you dispatched has not returned.

You may only delegate to `dev-agents:quick-read` or `dev-agents:quick-io`, never to another role agent or to `dev-agents:deepthink`. If the task needs a different role, state what was not completed in your return summary and let the main thread re-route.

Do not nest for fewer than 3 files or a single short command. The system-prompt overhead of a nested agent exceeds the context savings for small reads.

If a nested agent returns null or fails, state what was not completed in your return summary instead of describing it as pending.
