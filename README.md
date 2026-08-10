# claude-kit

Three Claude Code plugins that keep a long session cheap: subagents with the model
tier already bound per role, automatic truncation of verbose command output, and a
pack that manages this repository from inside Claude.

Every hook and script is a single `.mjs`, so macOS, Linux and native Windows run
identical code. `node` on `PATH` is the only requirement.

---

## Install

Check that `git` can reach the repository before anything else:

```bash
git clone --depth 1 https://github.com/Mouseww/claude-kit.git claude-kit-check
```

If that works, delete the directory and carry on. If it fails on authentication,
store a GitHub personal access token in your credential helper, or set git up to
reach `github.com` over SSH. Claude Code clones with whatever credentials git
already has and none of its own, so an auth problem surfaces here or nowhere.

Then, in any Claude Code session:

```
/plugin marketplace add https://github.com/Mouseww/claude-kit.git
/plugin install dev-agents@claude-kit
/plugin install context-trim@claude-kit
/plugin install claude-kit-meta@claude-kit
```

Install only the packs you want; they work on their own and better together.
Restart the session if the agents do not show up under `/agents`.

`/plugin` is an interactive panel, so it exists only in a `claude` terminal. In the
desktop app use the CLI form of the same commands: `claude plugin marketplace add
<url>`, then `claude plugin install <pack>@claude-kit`.

**One extra step for `dev-agents`, and it is the one that matters:**

```
/dev-agents:sync-claude-md --target user
```

A skill only enters context when it is invoked. That command installs the
delegation policy as a resident `CLAUDE.md` block instead, which is what actually
changes default behaviour. It writes only between managed markers, saves a `.bak`
first, is idempotent, and `--remove` takes it back out.

### For a whole project, so the team gets it

A marketplace is user-level: `/plugin install` affects your machine, every project.
To make a pack part of a *project*, run this from inside that project:

```
/claude-kit-meta:install-here dev-agents,context-trim
```

It writes two keys into the project's `.claude/settings.json`. Commit that file and
everyone who clones the project is prompted to install the same set.

### Updating

```bash
claude plugin marketplace update claude-kit
claude plugin update dev-agents@claude-kit
```

Restart the session, then re-run `sync-claude-md` if the pack ships a resident
block. Two ways this silently does nothing: the session was not restarted (agents
and skills are read once at startup), or `--target user` was dropped, which writes
a *second* block into the current directory instead of updating the real one.

---

## Usage

**Most of it needs no invoking.** Once installed:

| What | Happens on its own |
|---|---|
| Verbose output | A long build or test log comes back truncated behind a `[context-trim: ...]` header. If it looks like a failure, the error lines and the final verdict survive |
| Delegation | Claude picks a subagent by its description, already bound to the right model tier |
| Reminders | Three hooks nudge you after a long solo stretch, or when dispatching with no task plan. None of them ever blocks a call |
| Metrics | Every subagent call is logged to `~/.claude/context-offload-metrics.jsonl` |

**To be explicit, name what you want in plain language:**

```
use dev-agents:quick-read to find every caller of parseConfig
hand the migration to dev-agents:devops-engineer
```

**Slash commands:**

| Command | Does |
|---|---|
| `/dev-agents:sync-claude-md` | Install or refresh the resident delegation block |
| `/claude-kit-meta:list` | Show the packs and what each one ships |
| `/claude-kit-meta:install-here <names>` | Enable packs for the current project |
| `/claude-kit-meta:new-plugin <name> <desc>` | Scaffold a new pack and register it |

**Skills** load when they are relevant, or you can ask for one by name: the
`dev-agents` skill is the long reference on when delegating is a net loss.

> **One caveat, measured 2026-07-30.** Whether delegation happens *on its own*
> depends on which surface you are in. A terminal `claude` session dispatches
> agents by itself. The desktop app injects a product-level rule, *"do not call the
> AgentTool unless the user requested it"*, which suppresses proactive dispatch no
> matter what this pack's block says, and it is not a user setting. In the desktop
> app, name the agent explicitly; that path still works. `context-trim` is
> unaffected either way, because it never passes through the model.

---

## How it works

### `dev-agents`

Ten subagents with the model tier fixed per role, so you never pass `model` by
hand. `quick-read` (haiku) reads, searches and summarizes with no write access;
`quick-io` (sonnet) makes edits that follow a rule you can state; `deepthink`
(opus) decides and writes design docs but never touches source. Seven role agents
cover spec, backend, frontend, UI/UX, tests, review and ops.

Two separate things make it pay. A subagent's raw output stays in its own context,
so only the conclusion comes back. And its typing runs on a cheaper tier, which
never shows up in the transcript and so is the one that gets forgotten. Both apply
at every stage of a task rather than once implementation starts, which is where
the heaviest reading usually is.

The honest limit: none of this controls which model the *main thread* uses when it
writes files itself. For that you still want `/model opusplan`.

### `context-trim`

Replaces verbose tool output with a head/tail slice. When the output looks like a
failure it keeps the lines around the error keywords and forces the last lines to
survive, because a test run's verdict is at the end. Measured on real logs: 92,589
chars down to 4,449. It never makes context bigger, passing output through
untouched when the replacement would save less than 20%. Thresholds are constants
at the top of `plugins/context-trim/scripts/truncate-verbose-output.mjs`.

Its second hook logs every subagent call, which answers three otherwise invisible
questions: which agents you never actually use, how much context each delegation
hands back (an agent returning 4000+ chars is not distilling anything), and whether
nested delegation happens at all. Let it run a few days, then read the report:

```bash
node plugins/context-trim/scripts/report-metrics.mjs
```

The assumption that delegating beats reading inline might be wrong for your
workload, and this is how you find out.

### `claude-kit-meta`

Wraps this repository's own scripts as the slash commands listed under Usage.

---

## Maintaining this repository

An edit here reaches nobody until the version moves. Bump the pack's `version` in
`plugins/<pack>/.claude-plugin/plugin.json`, then:

```bash
node scripts/validate.mjs                                        # structure
node --test "plugins/**/tests/*.test.mjs" "tests/*.test.mjs"     # 44 tests
```

Both run in CI on Linux and Windows for every push. Run the validator even for a
one-word edit: a stray `": "` inside an agent's `description` silently voids its
whole frontmatter, so the agent loses its model and tools and nothing complains.
Only the validator sees it.

Commit, then update:

```bash
claude plugin marketplace update claude-kit
claude plugin update <pack>@claude-kit
```

Restart the session afterwards, and re-run `sync-claude-md` for a pack that ships
a resident block. Three things go wrong here, all of them quietly:

**The push is not what makes your own copy update.** If you added the marketplace
by path rather than by URL, its `source` in `known_marketplaces.json` is
`directory` and points at your clone, so the local update reads this working copy
and GitHub never enters into it. Push for everyone else, not for yourself.

**`@claude-kit` is not optional.** A bare `claude plugin update dev-agents` has to
guess which pack you mean across every installed marketplace. On 2026-08-04 it
answered `claude-kit-meta is already at the latest version (1.0.0)` and left
`dev-agents` on the old version, having never looked at it. The reply reads like
success.

**`/plugin` is an interactive panel, and the desktop app has no place to draw it.**
The slash commands in "Install" above work in a `claude` terminal; everywhere else
use the `claude plugin ...` CLI, which is the same functionality without the UI.

To check which copy is actually live, read the pack's `installPath` in
`~/.claude/plugins/installed_plugins.json`; `claude plugin list` does not show
versions.

**Adding a pack:** `/claude-kit-meta:new-plugin <name> <one-line description>`. By
hand it is four steps: copy `templates/plugin-template/`, fill in `plugin.json`,
add an entry to `.claude-plugin/marketplace.json`, run the validator.
[CONTRIBUTING.md](CONTRIBUTING.md) is the authority on layout and on the rules
the validator enforces.

**Enabling packs for a project by hand,** no plugin required:

```bash
node scripts/enable-in-project.mjs --project /path/to/the/project --plugins dev-agents,context-trim --dry-run
```

By default it registers *your* clone's path, which is wrong for anyone else on the
team, so point it at GitHub instead:

```bash
--source git --url https://github.com/Mouseww/claude-kit.git
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

**Layout:**

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
