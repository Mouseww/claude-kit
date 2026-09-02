# Working in this repository

This is claude-kit: a Claude Code plugin marketplace. Its content is capability
packs (skills, subagents, slash commands, hooks), not application code.

**Read `CONTRIBUTING.md` before adding or changing a pack.** It is the authority
on layout and on the rules `scripts/validate.mjs` enforces. This file only covers
what is easy to get wrong.

## Non-negotiables

1. **Node only for hooks and scripts.** No `.sh`, no `.ps1`, no `jq`, no `awk`.
   Single `.mjs` files, identical on macOS, Linux and native Windows. The
   validator rejects shell entry points. Do not reintroduce a per-platform pair
   "just for this one script" — that is exactly the drift this rule exists to
   prevent.

2. **`plugin.json` `name` == directory name == `marketplace.json` entry name.**
   All three. Claude Code namespaces commands and agents by plugin name.

3. **Every new pack gets an entry in `.claude-plugin/marketplace.json`.**
   Otherwise it cannot be installed and nobody finds out for months.

4. **Run both checks before saying the work is done:**
   ```bash
   node scripts/validate.mjs
   node --test "plugins/**/tests/*.test.mjs" "tests/*.test.mjs"
   ```

5. **The `shared:` marker blocks are load-bearing.** Several helpers
   (`quiet`, `readStdin`, `atomicWrite`, `pruneStale`, `appendJsonl`) are
   copied verbatim into every pack that needs them, wrapped in
   `// --- shared:<name> ---` comment pairs.
   `tests/hook-helpers-consistent.test.mjs` asserts every copy is
   byte-identical and is the source of truth for which script carries which
   helper. Change one copy and CI fails; change all of them and it passes.
   Do **not** replace this with a shared module under `plugins/`: every pack
   is installed independently via its own `source` in `marketplace.json`, so
   a shared directory is simply absent after `claude plugin add dev-agents`,
   and `scripts/validate.mjs` rejects any `plugins/` subdirectory that is not
   a listed pack. A sibling import *inside* one pack is fine and has
   precedent (`plugins/claude-kit-meta/scripts/check-daily-update.mjs`,
   `plugins/dev-agents/scripts/plan-store.mjs`).

## Things that look like bugs but are not

- `plugins/context-trim` writes its metrics to
  `~/.claude/context-offload-metrics.jsonl`. The `context-offload` name is
  historical and deliberately unchanged, so existing logs stay readable.
- Invariant B in `truncate-verbose-output.mjs` ("pass through on an empty body")
  guards a case the node implementation cannot easily reach. It predates the
  port, costs nothing, and is the correct last line of defence. Keep it.
- `scripts/enable-in-project.mjs` writes forward slashes into `settings.json`
  even on Windows, so the file is portable across a team.
- `require-task-plan.mjs` emits `additionalContext` under a **PreToolUse**
  `hookSpecificOutput`. That field is only documented for UserPromptSubmit and
  PostToolUse, but it was verified working on PreToolUse in a real session on
  2026-08-05 (the reminder text was injected on a planless dispatch). If a
  Claude Code update ever regresses it, the header comment says how to re-check.
  Do not "fix" it by switching to `permissionDecision: "deny"`; blocking a
  dispatch over a missing task list trades a small context loss for a hard
  failure, and the hook cannot tell a one-step delegation from a ten-step one.
  Known small noise: parallel Agent calls in one message can inject the
  reminder more than once.
- `skills:` in an agent's frontmatter injects the **full** skill body into that
  agent's context at startup and does not require `Skill` in `tools:`. Verified
  against the Claude Code subagent documentation on 2026-08-12. `validate.mjs`
  relies on this when it requires an `Agent`-granting agent to carry
  `nesting-discipline`, so do not delete that check as unfounded. An explicit
  `tools:` list is an allowlist, so omitting `Skill` only stops the agent
  loading *other* skills at run time; the preloaded ones are already present.
- `readStdin` carries two deadlines. The idle one (5s) covers a stream that
  goes quiet without an end event; the absolute one covers a stream that keeps
  producing, which resets the idle timer forever and used to mean the read
  never resolved. `truncate-verbose-output.mjs` passes 8000 explicitly because
  its hook budget is 10s and it is the one script that can receive a large
  continuous stream. Do not "simplify" this back to one timer.
- `plan-store.mjs` writes a `revision` on every record and rejects a write
  whose base revision has moved before it was re-read. This narrows the
  clobber window, it does not close it: a writer that reads revision N, is
  beaten to disk by another writer, and only then tries to write is correctly
  rejected and retries, but two writers that both read N and both pass the
  re-read before either renames will both write, and the second rename wins
  silently. Closing that fully would need an exclusive per-revision claim,
  and an orphaned claim from a crashed hook would wedge the store until the
  24h prune collected it, which is a worse failure than a lost update. Taken
  from `dsh-agent-teams`, which solves the same race with an attempt token.
- `plan-store.mjs` `extractSteps` probes several candidate key names and
  stores the raw payload under `raw`. The plan-creating tool's `tool_input`
  shape is not documented and differs between harness builds, so the
  tolerant probe is deliberate. Tighten it from an observed real `raw`
  payload, not from a guess.

## Where guidance goes: block vs skill

A pack has two places to put instructions, and they are not interchangeable:

- **`claude-md-block.md`** is resident on every turn once synced. Put here only
  what should change behaviour by default. It is a recurring token cost paid on
  every request, so a test caps its size; raise that cap deliberately.
- **`skills/<name>/SKILL.md`** loads only when invoked. Put the long reasoning,
  the edge cases, and the tables here.

Do not duplicate the block's content into the skill or vice versa. If something
moves between them, remove it from the other.

`scripts/sync-claude-md.mjs` is generic — any pack can ship a
`claude-md-block.md` with `markers` and `supersedes` frontmatter and be synced by
the same script. `supersedes` is what prevents a rename from leaving two
contradictory blocks resident in one file; set it whenever a marker name changes.

## Scope

Do not add capability content nobody asked for. Scaffolding a pack means
creating the structure; the skill body and agent prompts are the user's call.
