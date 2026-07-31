# claude-kit

A personal Claude Code capability repository. Skills, subagents, slash commands
and hooks, packaged as installable plugins, so anything worth reusing gets
installed anywhere with one command instead of copied around.

---

## What you get

Four packs. Install them separately; they are useful on their own and better
together.

### `dev-agents` — ten subagents with the cost profile fixed per role

Delegating work to a subagent keeps its raw output (file contents, grep hits,
build logs) out of your main conversation, and lets that work run on a cheaper
model. This pack gives you agents where the model tier is already bound to the
role, so you never pass a `model` parameter by hand.

| Agent | Model | Hand it |
|---|---|---|
| `quick-read` | haiku | Search, read, extract, summarize. No write access |
| `quick-io` | sonnet | Mechanical edits that follow a rule you can state |
| `deepthink` | opus | Design judgement, trade-offs, hard diagnosis. Writes docs, never code |
| `requirements-analyst` | opus | Vague ask → user stories, acceptance criteria, task breakdown |
| `backend-dev` | sonnet | APIs, business logic, data access, validation |
| `frontend-dev` | sonnet | Components, state, styling, accessibility |
| `ui-ux-designer` | sonnet | Interaction flows, layout, state design, prototypes |
| `test-engineer` | sonnet | Unit/integration/e2e, TDD, coverage. Includes Playwright |
| `quality-reviewer` | sonnet | Reviews a diff, ranked findings, read-only |
| `devops-engineer` | sonnet | CI/CD, containers, migrations, rollback |

**How you use it.** Mostly you do not have to do anything: Claude picks an agent
by its description. To be explicit, just say so — *"use dev-agents:quick-read to
find every caller of `parseConfig`"*, *"hand the migration to
dev-agents:devops-engineer"*.

> **Surface caveat, measured 2026-07-30.** Whether delegation happens *on its
> own* depends on which Claude Code surface you are in. A standalone terminal
> `claude` session carries only the stock "do not overuse subagents" guidance and
> dispatches agents by itself. The Claude desktop app injects a stricter
> product-level rule — *"Do not call the AgentTool unless the user requested
> it"* — which suppresses proactive dispatch regardless of what this pack's
> `CLAUDE.md` block says. It is not a user setting and cannot be removed.
>
> Consequence: in the desktop app, name the agent explicitly — that path is still
> allowed. For long multi-file work where automatic delegation is the whole
> point, run `claude` in a terminal. `context-trim`'s truncation is unaffected
> either way, because it never passes through the model.
>
> Check your own surface by asking a session: *"do your instructions restrict
> calling the Agent tool?"*

**The part that actually changes behaviour is the CLAUDE.md block, not the
skill.** A skill body only enters context when the skill is invoked; a
`CLAUDE.md` block is resident on every turn. So the pack ships both:

```
/dev-agents:sync-claude-md user      # or: project, or a path
```

That installs a ~2.4k-character delegation block between managed markers. It
edits nothing outside those markers, writes a `.bak` first, is idempotent, and
refuses to write if the markers are malformed rather than guessing. `--remove`
takes it back out. If it finds an older `context-offload` block it replaces it
in place, so you never end up with two contradictory delegation policies
resident at once.

The **`dev-agents` skill** is the long reference behind that block: when
delegation is a net loss (small edits, anything needing back-and-forth with you,
creating new content from scratch), how to brief an agent so the handoff is not
as expensive as doing the work, and the honest limit — none of this controls
which model the *main thread* uses when it writes files itself. For that you
still want `/model opusplan`. You rarely need to invoke it; the block covers
day-to-day.

**Three hooks**, all reminders, none of them ever blocking a tool call:

| Hook | Fires | Says |
|---|---|---|
| `nudge-subagent-delegation` | 16 consecutive Read/Grep/Glob, or 8 consecutive Edit/Write | The remaining work might be worth handing off |
| `require-task-plan` | Dispatching a subagent with no task plan yet | Build the plan first, or a long subagent run plus context compaction will lose your remaining steps |
| `track-task-plan` | You create a task plan | Nothing; it just records that one exists, so the hook above stops asking |

The task-plan pair fires on the first planless dispatch and then every third, so
a one-shot delegation is not nagged every time. Neither ever fires inside a
subagent, so nested delegation is untouched.

### `context-trim` — stop long command output from flooding the context

Two hooks, no prompting, nothing to remember.

**What you will notice:** a long build or test log comes back with a
`[context-trim: 92589 chars, ...]` header and a head/tail slice instead of the
whole thing. When the output looks like a *failure* it keeps the lines around the
error keywords **and forces the last lines to survive**, because a test run's
verdict is at the end.

| Real input | After | Saved |
|---|---|---|
| 200 lines × 500 chars, long-line log | 101,889 → 3,700 | 97% |
| 300 lines × 300 chars | 92,589 → 4,449 | 96% |
| single 40,000-char line | → 4,635 | 89% |
| 200 FAILED lines, tail summary kept | 17,418 → 3,115 | 83% |

It never makes context bigger: if the replacement would not save at least 20%,
it passes the output through untouched.

**Second hook, `measure-subagent`:** logs every subagent call to
`~/.claude/context-offload-metrics.jsonl`. Read the report with:

```bash
node plugins/context-trim/scripts/report-metrics.mjs
```

Run that from a clone of this repository, or from the pack's installed copy under
`~/.claude/plugins/cache/`.

It answers three things that are otherwise invisible: which agents you never
actually use (delete them), how much context each delegation hands back (an agent
returning 4000+ chars is not distilling anything), and whether nested delegation
happens at all. Let it run a few days — the assumption that delegating is cheaper
than reading inline might be wrong for your workload, and this is how you find
out.

To tune thresholds, edit the constants at the top of
`plugins/context-trim/scripts/truncate-verbose-output.mjs`. Read the
`context-trim` skill first (`/plugin` → the skill, or just ask Claude about it).

### `fleet-engineering` — a team process that parallel agents cannot corrupt

One skill, but a large one: the methodology for running agent-first development
when more than one person commits to the repo. A solo harness quietly assumes a
single writer — sequential file numbering, hand-edited index files, one shared
dashboard, advisory "check for conflicts" steps. Two people working the same day
break all four. This pack removes the assumption rather than asking people to be
careful:

| Single-writer habit | What replaces it |
|---|---|
| `docs/exec-plans/active/014-foo.md` | `{TICKET}-{slug}.md`; IDs come from the ticket system, never from counting files |
| Hand-edited `index.md`, one `QUALITY_SCORE.md` | Generated from per-doc frontmatter, CI-checked, hand-edits blocked by a hook |
| "Check `active/` before you start" | Every plan declares a **Claims** section; it merges to main *before* implementation and CI warns on overlap |
| Process lives on one person's machine | Skill, evaluator agent, docs linter, hooks and CODEOWNERS are committed and reviewed like code |

The gate that does the most work is **Step E**: the agent that wrote the code is
not allowed to sign it off. An independent `fleet-evaluator` subagent must return
`PASS` — zero blockers, zero majors, max three rounds — before a code PR is
opened, and the main agent may never override a blocker. Human review still
happens after that; the evaluator is the precondition, not a replacement.

Ships the templates the process needs (product spec, design doc, execution plan
with Claims, tech debt entry, quality area, `docs_lint.py`, CODEOWNERS, the
generated-file-blocking hook) plus a .NET stack guide with architecture rules,
architecture tests and a CI workflow. Everything else is language-agnostic. The
evaluator ships as a real agent, `fleet-engineering:fleet-evaluator`, so Step E
works the moment you install the pack — nothing to scaffold first.

**Installing at user level is enough to work this way.** The skill, every
template and the evaluator are all live on every project on the machine as soon
as `/plugin install` finishes. Principle 12 ("the process is in the repo") is not
a claim that a user-level install is inert; it is about what a *team* needs, and
it only bites on three things:

| Thing | Why user level is not enough for a team |
|---|---|
| `tools/docs_lint.py` | CI runs it. A copy on your laptop cannot gate anyone's PR |
| `CODEOWNERS`, the CI workflow, the generated-file hook | Same: they only enforce anything from inside the repo |
| The skill and evaluator *versions* | Each teammate installing their own copy is exactly the process drift principle 12 exists to stop |

So: install the pack for yourself and use it today. When a team adopts it, run
the skill's Project Initialization as well, which copies the skill into
`{repo}/.claude/skills/` and the evaluator into `{repo}/.claude/agents/` — at
which point the plain `fleet-evaluator` id resolves to the repo's pinned copy and
everyone audits against the same version.

One dependency note: the shipped `docs_lint.py` and `block-generated-docs.py`
templates are Python. That does not violate this repo's node-only rule — they are
payload for the target repository, not hooks of this one — but the team adopting
them needs Python 3 in CI.

### `claude-kit-meta` — manage this repository from inside Claude

| Command | Does |
|---|---|
| `/claude-kit-meta:list` | Show the packs and what each one ships |
| `/claude-kit-meta:install-here <names>` | Enable packs for the current project |
| `/claude-kit-meta:new-plugin <name> <desc>` | Scaffold a new pack and register it |

---

## Install

### Once per machine

This repository is private, so `git` on your machine needs Bitbucket credentials
before Claude Code can clone it. Check that first:

```bash
git clone --depth 1 https://bitbucket.org/rspcode/claude-kit.git claude-kit-check
```

If that works, delete the directory and carry on. If it fails on authentication,
create a Bitbucket app password and store it in your credential helper, or set git
up to reach `bitbucket.org` over SSH. Claude Code clones with whatever credentials
git already has; it has none of its own.

Then, in any Claude Code session:

```
/plugin marketplace add https://bitbucket.org/rspcode/claude-kit.git
```

Then install what you want:

```
/plugin install dev-agents@claude-kit
/plugin install context-trim@claude-kit
/plugin install fleet-engineering@claude-kit
/plugin install claude-kit-meta@claude-kit
```

Verify with `/plugin` (packs listed and enabled), `/agents` (the ten agents
appear), and `/hooks` (the truncation and nudge hooks are registered). If the
agents do not show up, restart the session.

Editing the packs yourself? Point the marketplace at your own clone instead of the
URL and your edits are visible without pushing:

```
/plugin marketplace add /absolute/path/to/your/clone
```

### Updating

**If you only use the packs.** Once a change has been pushed:

```bash
claude plugin marketplace update claude-kit
claude plugin update dev-agents@claude-kit
```

Then **restart the session**. If the pack ships a resident block, re-sync it:

```
/dev-agents:sync-claude-md --target user
```

Swap `dev-agents` for whichever pack you want. That is the whole flow.

**If you edit the packs.** An edit reaches nobody until the version moves. Bump the
pack's `version` in `plugins/<pack>/.claude-plugin/plugin.json`, run the checks from
the repository root, then commit and push:

```bash
node scripts/validate.mjs
node --test "plugins/**/tests/*.test.mjs" "tests/*.test.mjs"
```

Then run the two update commands above like anyone else.

Three ways this silently does nothing, all of them quiet:

- **The version was not bumped.** The update has nothing to do and the old copy
  keeps loading. Bump every time, even for a one-word change.
- **The session was not restarted.** Agents and skills are read once at startup.
- **`--target user` was dropped.** The default writes a *second* block into the
  current directory instead of updating the one in `~/.claude/CLAUDE.md`, and then
  both load on every turn.

Run the validator even for a one-word edit. A stray `": "` inside an agent's
`description` silently voids its whole frontmatter, so the agent loses its model
and tools and nothing complains. Only the validator sees it.

To check which copy is live, read the pack's `installPath` in
`~/.claude/plugins/installed_plugins.json`. `claude plugin list` does not show
versions.

### Per project, so the whole team gets it

A marketplace is user-level: `/plugin install` affects *your* machine, every
project. Making a pack part of a *project* means two keys in that project's
`.claude/settings.json`, committed to the project repo, so everyone who clones it
is prompted to install the same set.

From inside the target project:

```
/claude-kit-meta:install-here dev-agents,context-trim
```

Or directly, no plugin required:

```bash
node scripts/enable-in-project.mjs --project /path/to/the/project --plugins dev-agents,context-trim --dry-run
```

Run that from a clone of this repository. By default it registers *your* clone's
path, which is wrong for anyone else on the team, so point it at Bitbucket instead:

```bash
--source git --url https://bitbucket.org/rspcode/claude-kit.git
```

Drop `--dry-run` to apply. It deep-merges into existing settings, never removes a
key it did not add, prints a diff, and writes a timestamped `.bak` first.

| Flag | Effect |
|---|---|
| `--list` | Show available packs and what each ships |
| `--dry-run` | Print the resulting file and diff, write nothing |
| `--remove` | Disable the named packs for that project |
| `--force` | Overwrite conflicting existing values (off by default) |
| `--source git --url <url>` | Register a remote marketplace instead of this directory |

Then commit `.claude/settings.json`.

---

## Requirements

`node` on `PATH`. That is the whole list. Every hook and script here is a single
`.mjs`, so macOS, Linux and native Windows run identical code — no `.sh`/`.ps1`
pairs to keep in sync, no `jq`, no `awk`.

## Adding a capability

```
/claude-kit-meta:new-plugin <name> <one-line description>
```

By hand it is four steps: copy `templates/plugin-template/`, fill in
`plugin.json`, add an entry to `.claude-plugin/marketplace.json`, run the
validator. [CONTRIBUTING.md](CONTRIBUTING.md) is the authority on layout and on
the rules the validator enforces.

## Checks

```bash
node scripts/validate.mjs                                        # structure
node --test "plugins/**/tests/*.test.mjs" "tests/*.test.mjs"     # 44 tests
```

Both run in CI on Linux and Windows for every push. The test glob is quoted so
node expands it, which means a new test file is picked up with no config change.

## Layout

```
.claude-plugin/marketplace.json   the manifest; every pack must be listed here
plugins/<name>/                   one capability pack per directory
  .claude-plugin/plugin.json      name must equal the directory name
  skills/ agents/ commands/       whatever the pack ships
  hooks/hooks.json  scripts/      event wiring and its node entry points
templates/plugin-template/        skeleton for a new pack
scripts/validate.mjs              structural validator, run by CI
scripts/enable-in-project.mjs     project-level installer
docs/specs/                       design documents
```
