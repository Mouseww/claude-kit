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
   node --test plugins/context-trim/tests/truncate.test.mjs
   ```

## Things that look like bugs but are not

- `plugins/context-trim` writes its metrics to
  `~/.claude/context-offload-metrics.jsonl`. The `context-offload` name is
  historical and deliberately unchanged, so existing logs stay readable.
- Invariant B in `truncate-verbose-output.mjs` ("pass through on an empty body")
  guards a case the node implementation cannot easily reach. It predates the
  port, costs nothing, and is the correct last line of defence. Keep it.
- `scripts/enable-in-project.mjs` writes forward slashes into `settings.json`
  even on Windows, so the file is portable across a team.

## Scope

Do not add capability content nobody asked for. Scaffolding a pack means
creating the structure; the skill body and agent prompts are the user's call.
