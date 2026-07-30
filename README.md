# claude-kit

A personal Claude Code capability repository. Skills, subagents, slash commands
and hooks, packaged as installable plugins, so anything worth reusing gets
installed anywhere with one command instead of copied around.

---

## What you get

Three packs. Install them separately; they are useful on their own and better
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
by its description. To be explicit, just say so — *"use quick-read to find every
caller of `parseConfig`"*, *"hand the migration to devops-engineer"*.

It also ships a **`dev-agents` skill** that Claude reads when it is deciding
whether to delegate at all. That skill is the actual value: it covers when
delegation is a net loss (small edits, anything needing back-and-forth with you,
creating new content from scratch), how to brief an agent so the handoff is not
as expensive as doing the work, and the honest limit — none of this controls
which model the *main thread* uses when it writes files itself. For that you
still want `/model opusplan`.

And a **nudge hook**: after 16 consecutive Read/Grep/Glob calls, or 8 consecutive
Edit/Write calls, it points out that the remaining work might be worth handing
off. Once per threshold, never inside a subagent.

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
node ~/projects/claude-kit/plugins/context-trim/scripts/report-metrics.mjs
```

It answers three things that are otherwise invisible: which agents you never
actually use (delete them), how much context each delegation hands back (an agent
returning 4000+ chars is not distilling anything), and whether nested delegation
happens at all. Let it run a few days — the assumption that delegating is cheaper
than reading inline might be wrong for your workload, and this is how you find
out.

To tune thresholds, edit the constants at the top of
`plugins/context-trim/scripts/truncate-verbose-output.mjs`. Read the
`context-trim` skill first (`/plugin` → the skill, or just ask Claude about it).

### `claude-kit-meta` — manage this repository from inside Claude

| Command | Does |
|---|---|
| `/claude-kit-meta:list` | Show the packs and what each one ships |
| `/claude-kit-meta:install-here <names>` | Enable packs for the current project |
| `/claude-kit-meta:new-plugin <name> <desc>` | Scaffold a new pack and register it |

---

## Install

### Once per machine

In any Claude Code session:

```
/plugin marketplace add C:/Users/webber_wei/projects/claude-kit
```

Then install what you want:

```
/plugin install dev-agents@claude-kit
/plugin install context-trim@claude-kit
/plugin install claude-kit-meta@claude-kit
```

Verify with `/plugin` (packs listed and enabled), `/agents` (the ten agents
appear), and `/hooks` (the truncation and nudge hooks are registered). If the
agents do not show up, restart the session.

Once this repository lives on a remote, the same command takes the URL instead of
the local path. Nothing inside the repository changes.

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
node C:/Users/webber_wei/projects/claude-kit/scripts/enable-in-project.mjs --project . --plugins dev-agents,context-trim --dry-run
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
node scripts/validate.mjs                                       # structure
node --test plugins/context-trim/tests/truncate.test.mjs        # unit tests
```

Both run in CI on Linux and Windows for every push.

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
