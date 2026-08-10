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
