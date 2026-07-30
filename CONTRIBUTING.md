# Contributing to claude-kit

This is the authority on repository layout. `scripts/validate.mjs` enforces the
mechanical parts of it; the rest is convention, and this document is why.

## The unit is a capability pack

One directory under `plugins/` is one pack. A pack may ship any mix of skills,
subagents, slash commands and hooks. There is no separate "skills repository"
and "agents repository" — if two things are only useful together, they belong in
the same pack.

Split into a new pack when someone would plausibly want one without the other.
`context-trim` and `dev-agents` are separate for exactly that reason: the
truncation hooks are useful even if you never delegate to a subagent.

## Adding a pack

```
/claude-kit-meta:new-plugin <name> <one-line description>
```

By hand:

1. `cp -r templates/plugin-template plugins/<name>`
2. Fill in `plugins/<name>/.claude-plugin/plugin.json`. `name` must equal the
   directory name.
3. Delete every part of the template the pack does not use, including the
   `"hooks"` key if there are no hooks.
4. Add an entry to `.claude-plugin/marketplace.json`:
   ```json
   {
     "name": "<name>",
     "source": "./plugins/<name>",
     "description": "same text as plugin.json",
     "category": "productivity",
     "tags": ["..."]
   }
   ```
5. `node scripts/validate.mjs`

## Rules the validator enforces

| Rule | Why it exists |
|---|---|
| `plugin.json` `name` equals its directory name | Claude Code namespaces commands and agents by plugin name. A mismatch silently changes every `/command` path and every agent id. |
| Every directory under `plugins/` is listed in `marketplace.json` | An unlisted pack is invisible. It looks like a bug months later. |
| Every `source` in `marketplace.json` resolves to a real directory with a `plugin.json` | The commonest mistake when adding a pack. |
| `SKILL.md` frontmatter has `name` + `description`, and `name` matches its directory | The description is the only thing the model sees when deciding whether to load the skill. |
| Agent frontmatter has `name` + `description`, and `name` matches the filename | Same, plus the id must be stable. |
| Command frontmatter has `description` | It is the entry in the slash-command list. |
| Every file a `hooks.json` command references exists | A dangling hook command fails silently on **every** tool call. |
| Hook commands invoke `node`, never `.sh` / `.ps1` / `.bat` | See below. |

Warnings do not fail the build. Errors do.

## Node only, no shell

Every hook entry point and every repository script is a single `.mjs` file run
with `node`. No `.sh`, no `.ps1`, no `jq`, no `awk`.

This is not stylistic. The previous arrangement kept a `.sh` and a `.ps1`
implementation of each hook plus a `hooks.windows-native.json` variant, and the
two implementations drifted: a tunable changed in one and not the other, and the
Windows path silently stopped matching the documented behaviour. One file cannot
drift from itself.

The cost is a `node` dependency. Claude Code users effectively have one already,
and it buys identical behaviour on all three platforms plus a real test runner.

### Hook contract

- stdin is one JSON object; stdout is either nothing or one JSON object.
- Exit 0 unless you deliberately intend to block the tool call.
- On any input you do not fully recognise, write nothing and exit 0. A hook that
  guesses is worse than one that abstains.
- Guard on `tool_name` inside the script, not only through the `hooks.json`
  matcher, so widening the matcher later cannot silently widen behaviour.
- Never let an exception escape. A crashing hook fires on every tool call.

`templates/plugin-template/scripts/example-hook.mjs` is the shape;
`plugins/context-trim/scripts/truncate-verbose-output.mjs` is a worked example.

## Writing the description

For a plugin, the description is read by a human in `/plugin`. For a skill or an
agent, it is read by the model to decide whether this thing is relevant right
now. Those are different jobs:

- **Plugin**: name the problem it solves. "Truncates long command output before
  it reaches the model" beats "context management utilities".
- **Skill**: describe *when* to read it, not what it contains. Lead with
  "Use when ...".
- **Agent**: say what to hand it **and what to hand elsewhere**. The
  "do not use it for X, hand that to Y" half is what stops the orchestrator
  picking the wrong agent.

## Tests

Anything with non-trivial logic gets a test next to it under the pack's `tests/`,
using `node --test`. No test framework, no dependencies.

```bash
node --test plugins/<name>/tests/<file>.test.mjs
```

The `context-trim` suite is the model to follow: it asserts named invariants
rather than exact output, so the algorithm can change without rewriting the
tests.

## Versioning

Bump `version` in the pack's `plugin.json` when its behaviour changes. Bump
`metadata.version` in `marketplace.json` when packs are added or removed. Nothing
enforces this; it is the only signal a user has that a reinstall is worth doing.

## Before committing

```bash
node scripts/validate.mjs
node --test plugins/context-trim/tests/truncate.test.mjs
```

Both run in CI, on GitHub Actions and Bitbucket Pipelines.
