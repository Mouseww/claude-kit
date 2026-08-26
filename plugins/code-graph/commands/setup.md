---
description: Check for the code-review-graph CLI, install it if missing, and build the initial graph for this repo.
allowed-tools: Bash(code-review-graph:*), Bash(uv:*), Bash(pip:*), Bash(python:*), Bash(which:*), Bash(command:*)
---

First-time setup for the `code-graph` pack. This pack itself ships no parser
and no daemon; it only wires the external `code-review-graph` CLI's MCP server
into Claude Code once that CLI exists on this machine.

Steps:

1. Check whether `code-review-graph` is already on `PATH`
   (`command -v code-review-graph` or `which code-review-graph`). If it is
   found, skip to step 3.

2. If it is not found, install it with one of:

   ```
   uv tool install code-review-graph
   ```

   or

   ```
   pip install code-review-graph
   ```

   Prefer `uv tool install` if `uv` is available, since it isolates the CLI
   without touching the active Python environment. There is no `pipx` fallback
   assumed here — do not suggest it unless you have confirmed it is installed.

3. Build the initial graph for the current repo:

   ```
   code-review-graph build
   ```

   This creates `.code-review-graph/graph.db` in the current working
   directory. It can take a while on a large repo; let it finish rather than
   backgrounding it, since the graph is useless until the build completes.

4. **Do not run `code-review-graph install`.** That command is the upstream
   project's own installer, and it writes a `hooks.json` that refreshes the
   graph after every `Write`/`Edit`/`Bash` call (with a 30-second timeout per
   call) and injects `status` output at every session start. This pack
   deliberately does not ship that behavior — see the `code-graph` skill for
   why — and running the upstream installer on top of this pack reintroduces
   exactly the cost this pack was built to avoid. Use `/code-graph:refresh`
   instead, on demand.

5. Confirm the build succeeded (e.g. `.code-review-graph/graph.db` exists) and
   tell the user setup is complete.

6. If the user manually edits the `--tools` whitelist in `.mcp.json`, be aware
   that a misspelled tool name is **not** rejected or reported —
   `code-review-graph serve --tools ...` silently drops any name it doesn't
   recognize, so a typo just means one fewer tool (or, in the worst case, zero
   tools) with no diagnostic. The only way to check is to look at the actual
   MCP tool list exposed after restarting the server and count what came
   through.

7. As a reference point, on a 30-file repo `code-review-graph build` took
   about 4 seconds and produced a `graph.db` of about 4.8MB. Expect this to
   scale up meaningfully on larger repos.

8. Make sure `.code-review-graph/` (the directory the graph database lives
   in) is in `.gitignore`. `graph.db` is an unencrypted local database whose
   contents are structurally equivalent to the source code (call graph,
   node/edge data), so it should never be committed.
