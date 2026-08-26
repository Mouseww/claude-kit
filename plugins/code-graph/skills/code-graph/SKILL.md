---
name: code-graph
description: Use when a task needs to trace callers/callees, blast radius of a change, test coverage of a function, or cross-file inheritance in this repo, and the code-review-graph MCP server might be installed. Explains how to probe for its tools before relying on them, when a graph query beats grep, when it does not (fuzzy semantic search, flow detection, single-file edits), and how dev-agents:quick-read and dev-agents:quality-reviewer should change their approach when the graph is available.
---

# code-graph

This pack wires the `code-review-graph` MCP server (external, Python, installed
separately) into delegated reads. It ships no hooks and no bundled parser: the
graph is a local SQLite database the external tool builds and refreshes on
demand, and the only thing this pack adds is the judgement for when to query it
instead of grepping.

## Probe first, never assume

Skill frontmatter has no mechanism that gates loading on an MCP tool actually
being present — `compatibility`-style fields are accepted by the schema but not
enforced. So this skill can load in a session where `code-review-graph` was
never installed, or was installed but the graph was never built.

Before relying on any graph query, check whether the `code-review-graph` MCP
tools are actually listed as available. If they are not, or a call to one comes
back with a "not found" / connection error, fall back to grep/Glob silently.
Do not tell the user the plugin is broken and do not suggest they install
anything — this pack is `defaultEnabled: false` precisely because installing it
is the user's decision, not something to prompt for mid-task. Silent
degradation to the old grep path is the correct behavior, every time.

## Only 9 of the upstream tools are wired up

`code-review-graph` exposes about 30 MCP tools by default, and their combined
schema costs roughly 8.6k tokens (measured: ~37,795 characters, cl100k_base)
that would otherwise sit in every LLM call's system prompt for the rest of the
session. That cost is the reason this pack exists at all, not a footnote: the
`.mcp.json` here passes `--tools` to cut the exposed set down to 9:

- `get_minimal_context_tool` — cheap (~100 token) task-scoped context; call
  this first, before anything else.
- `semantic_search_nodes_tool` — resolves a name into a graph node; the entry
  point for the other queries below.
- `query_graph_tool` — predefined relationship queries: callers, callees,
  inheritance, test coverage.
- `traverse_graph_tool` — BFS/DFS traversal with a token budget.
- `get_impact_radius_tool` — blast radius of a change.
- `get_review_context_tool` — token-efficient review context for a diff.
- `detect_changes_tool` — change risk scoring and review prioritization.
- `list_graph_stats_tool` — check whether the graph exists or is stale.
- `build_or_update_graph_tool` — the only way to refresh the graph without
  asking the user to run a command (see "The graph goes stale" below).

If you read about some other `code-review-graph` tool elsewhere — wiki
generation, communities/architecture/hub/bridge analysis,
knowledge-gaps/surprising-connections/suggested-questions, flows, cross-repo
tools, docs sections, large-functions, postprocess, `refactor_tool`,
`apply_refactor_tool`, `embed_graph_tool` — it is not available here. That is
deliberate, not an oversight. Do not try to work around it (there is no way to
call a tool that was never exposed), and do not suggest the user edit the
`--tools` whitelist to get it back; that whitelist is this pack's whole reason
for existing.

`apply_refactor_tool` in particular is excluded as a hard boundary, not a
trimming choice: it rewrites source files directly, and a pack whose job is to
query a read-only graph should never carry write access to the code it
describes. `refactor_tool` (its preview counterpart) is excluded alongside it
for the same reason. `embed_graph_tool` is excluded because it can trigger
model downloads or calls out to a cloud embedding service, which conflicts
with this pack shipping no outbound calls of its own.

## When the graph beats grep

These are deterministic structural queries, and grep answers them only by
approximation:

- **Who calls this function / who does it call.** Grep for a function name
  finds string matches, including comments, unrelated overloads and
  coincidental substrings; the graph's call edges do not.
- **Blast radius of a change.** "If I change this function's signature, what
  else needs to change" is a transitive closure over the call graph. Grepping
  for the name and manually tracing each hit is the same computation done by
  hand, slower and more error-prone.
- **Test coverage of a function.** The graph records which test nodes exercise
  which code nodes directly, rather than guessing from file/directory naming
  conventions.
- **Cross-file inheritance.** Which classes extend or implement a given base,
  across a repo where grep for the class name would also catch every
  instantiation and every docstring mention.

In all four cases, the payoff is precision, not speed: fewer false positives
means less irrelevant context gets pulled in and read, which is the whole
reason this pack exists in a context-economy toolset.

## When not to reach for it

Be honest about the tool's own documented limits, because trusting it past them
produces wrong answers with high confidence:

- **Semantic / fuzzy search.** The upstream project reports a mean reciprocal
  rank of about 0.35 on its own semantic search, and says ranking needs
  improvement. Do not use the graph to find "the code that does X" when X is a
  concept rather than a name — grep or a targeted read still wins there.
- **Flow / data-flow detection.** Reported recall is around 33%. Treat a
  "no flow found" result as inconclusive, not as proof no flow exists.
- **Impact analysis on large graphs.** The tool is deliberately conservative
  here, which means false positives (things flagged as impacted that are not)
  are expected on big dependency graphs. Treat a large blast-radius result as a
  candidate list to verify by reading, not a final answer.
- **Small, single-file changes.** Querying the graph, waiting on a result, and
  interpreting it can cost more than just opening the one file and reading it.
  Reach for the graph when the question spans files or requires traversal, not
  for a change contained in something you were about to read anyway.

The graph narrows where to look; it does not replace reading the source. Always
follow a graph hit back to the actual code before acting on it.

## How this changes dev-agents delegation

`dev-agents:quick-read`, when asked to locate callers, blast radius, test
coverage or inheritance and the graph tools are available, should query the
graph first and read only the files the graph points at, instead of grepping
the whole repo and skimming hits. This is a strict reduction in what gets
pulled into context: grep returns text matches to filter, the graph returns
exactly the nodes and edges asked for.

`dev-agents:quality-reviewer`, when reviewing a diff, can use the graph to
answer "what else calls the function this diff changed" and "what tests cover
it" before reading the surrounding code, so the review's blast-radius section
is backed by traversal rather than by guessing from naming.

Neither agent should treat a graph result as sufficient on its own — see
"When not to reach for it" above. The graph changes what gets read first, not
whether the code still gets read.

## The graph goes stale, and there is no hook to catch it

This pack does not install any per-edit or per-session hook, unlike the
upstream project's own `hooks.json`, which refreshes the graph after every
Write/Edit/Bash call and injects `status` output at session start. Both were
judged too expensive for routine use: a 30-second refresh after every edit, and
unconditional context injection on every session.

That tradeoff means the graph can be out of date with the working tree. Refresh
it (`/code-graph:refresh`, which runs `code-review-graph update`) when either
of these is true: a batch of edits just landed that plausibly changed call
graphs, imports, or test coverage, or a graph query result looks inconsistent
with what a file actually contains — e.g. it claims a function has no callers
that a grep clearly finds, or misses a class that plainly extends another. Do
not refresh reflexively on every query; that reintroduces the cost this pack
was built to avoid.

`build_or_update_graph_tool` is in the whitelist above, so the model does not
have to route every refresh through the user running a slash command — it can
call that tool directly when the staleness conditions above are met.
