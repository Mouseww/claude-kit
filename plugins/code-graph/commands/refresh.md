---
description: Incrementally refresh the code-review-graph database on demand, instead of on every edit.
allowed-tools: Bash(code-review-graph:*)
---

Run an on-demand incremental update of the graph, replacing the upstream
project's per-edit hook that this pack does not install.

Steps:

1. Run:

   ```
   code-review-graph update
   ```

   Add `--skip-flows` for a faster refresh when flow/data-flow edges are not
   needed for the task at hand (flow detection has low recall regardless — see
   the `code-graph` skill — so skipping it is rarely a real loss).

2. If the command fails because no graph exists yet (`.code-review-graph/`
   missing), tell the user to run `/code-graph:setup` first rather than
   retrying.

3. Report success or the error output; do not silently retry on failure.
