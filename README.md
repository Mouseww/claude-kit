# claude-kit

Five Claude Code plugins that keep a long session cheap: subagents with the model
tier already bound per role, automatic truncation of verbose command output, answers
that name the real file instead of a stand-in label and lead with the conclusion
instead of a noun stack or filler, a code graph that answers "who calls this"
without a grep sweep, and a pack that manages this repository from inside
Claude.

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
/plugin install concrete-answers@claude-kit
/plugin install context-trim@claude-kit
/plugin install code-graph@claude-kit
/plugin install claude-kit-meta@claude-kit
```

Install only the packs you want; they work on their own and better together.
Restart the session if the agents do not show up under `/agents`.

`code-graph` is the one pack here that installing does not turn on by itself:
it ships `defaultEnabled: false` because it depends on an external CLI only you
can install. Run `/code-graph:setup` once that CLI is in place — see `code-graph`
under How it works for what it wires in and what it deliberately leaves out.

`/plugin` is an interactive panel, so it exists only in a `claude` terminal. In the
desktop app use the CLI form of the same commands: `claude plugin marketplace add
<url>`, then `claude plugin install <pack>@claude-kit`.

**One extra step for the two packs that ship a resident block, and it is the one
that matters:**

```
/dev-agents:sync-claude-md --target user
/concrete-answers:sync-claude-md --target user
```

A skill only enters context when it is invoked. Those commands install the
delegation policy and the reporting rules as resident `CLAUDE.md` blocks instead,
which is what actually changes default behaviour. Each writes only between its own
managed markers, saves a `.bak` first, is idempotent, and `--remove` takes it back
out.

### For a whole project, so the team gets it

A marketplace is user-level: `/plugin install` affects your machine, every project.
To make a pack part of a *project*, run this from inside that project:

```
/claude-kit-meta:install-here dev-agents,context-trim
```

It writes two keys into the project's `.claude/settings.json`. Commit that file and
everyone who clones the project is prompted to install the same set.

### Updating

With `claude-kit-meta` installed this mostly takes care of itself. On your first
prompt of each day it checks the marketplace in the background, updates every
installed pack, and re-runs `sync-claude-md` for packs that ship a resident block.
It fires at most once per calendar day, skips the work entirely when nothing
changed, and never blocks the prompt.

To pull a change in right now rather than wait for tomorrow:

```bash
claude plugin marketplace update claude-kit
claude plugin update dev-agents@claude-kit
```

Restart the session, then re-run `sync-claude-md` if the pack ships a resident
block. Two ways this silently does nothing: the session was not restarted (agents
and skills are read once at startup), or `--target user` was dropped, which writes
a *second* block into the current directory instead of updating the real one.

**On `claude-kit-meta` older than 1.2.2 the daily check is dead, and it cannot
revive itself:** the bug sits in the very script that would fetch its own fix, so
waiting will never help. Bootstrap it once by hand:

```bash
claude plugin update claude-kit-meta@claude-kit
```

Restart after that and the daily check takes over.

---

## Usage

**Most of it needs no invoking.** Once installed:

| What | Happens on its own |
|---|---|
| Verbose output | A failing build or test log comes back truncated behind a `[context-trim: ...]` header, with the error lines and the final verdict kept. Clean output is left whole unless it is very large |
| Delegation | Claude picks a subagent by its description, already bound to the right model tier |
| Reminders | Five hooks nudge you after a long solo stretch, when dispatching with no task plan, when a dispatch comes back interrupted, empty or suspiciously thin, and when the fable-tier last resort is about to be called. None of them ever blocks a call |
| Reporting | Answers name real paths, symbols and commands instead of stand-in labels like `$1.1` or shape-words like "improved robustness", lead with the conclusion, and recommend instead of listing options |
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
| `/concrete-answers:sync-claude-md` | Install or refresh the resident reporting and writing-style block |
| `/code-graph:setup` | Check for the `code-review-graph` CLI, install it if missing, and build the initial graph |
| `/code-graph:refresh` | Incrementally update the graph on demand, instead of on every edit |
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

Eleven subagents with the model tier fixed per role, so you never pass `model` by
hand. `quick-read` (haiku) reads, searches and summarizes with no write access;
`quick-io` (sonnet) makes edits that follow a rule you can state; `deepthink`
(opus) decides and writes design docs but never touches source. Seven role agents
cover spec, backend, frontend, UI/UX, tests, review and ops.

The eleventh, `last-resort` (fable), is gated rather than routed: it is for a
problem the opus tier has already failed to solve, and a hook prints its four
preconditions on every dispatch, because an accidental call is the most expensive
mistake this pack can make.

Two separate things make it pay. A subagent's raw output stays in its own context,
so only the conclusion comes back. And its typing runs on a cheaper tier, which
never shows up in the transcript and so is the one that gets forgotten. Both apply
at every stage of a task rather than once implementation starts, which is where
the heaviest reading usually is.

The honest limit: none of this controls which model the *main thread* uses when it
writes files itself. For that you still want `/model opusplan`.

Seven of the eleven agents also name a skill in their frontmatter that this
repository does not ship: `security-review` (quality-reviewer), `api-design`
(backend-dev), `deployment-patterns` (devops-engineer), `systematic-debugging`
(deepthink and last-resort), `frontend-design` (frontend-dev and ui-ux-designer),
`writing-plans` (requirements-analyst), and `e2e-testing` (test-engineer).
`nesting-discipline` is the only companion skill that actually lives in this
repo; the rest are meant to come from a user's global `~/.claude/skills` or
another marketplace pack, so for anyone who installed only `dev-agents` the
reference silently does nothing. Each of the seven is listed under
`externalSkills` in `plugins/dev-agents/.claude-plugin/plugin.json` — a key
Claude Code itself ignores, kept so this repo's validator, and anyone reading
the manifest, can tell "not shipped here" apart from "missing by mistake."
`scripts/validate.mjs` checks every skill an agent's frontmatter names against
both the repo's own `plugins/*/skills/<name>/SKILL.md` paths and that
allowlist: a misspelled name fails the build, an absent-but-allowlisted one
does not, because these seven are not supposed to exist in this repo. It also
warns when an allowlisted name turns out to already exist in the repo, since
that means the allowlist entry has gone stale. None of the seven agents
assumes its skill is loaded; each has fallback wording in its prompt body for
the case where it is not. Anyone who wants the fuller behavior installs the
same-named skill wherever their own `~/.claude/skills` or marketplace already
keeps it — nothing in `dev-agents` needs to change for it to be picked up.
Contributors adding a new agent that references a skill from outside this repo
must add it to `externalSkills` in the same change, or the validator turns red.

### `context-trim`

Cuts failing command output down to the error lines plus the final verdict, because
a test run's verdict is at the end. Measured on real logs: 92,589 chars down to
4,449.

Clean output is a different problem and gets different treatment. Cutting a result
the model deliberately went and fetched is how you get it to fetch the result
again, and that rerun costs more than the trim saved. So clean output passes
through whole until 30,000 chars, and picks up a "use Read instead" tip rather than
losing its middle. Over 329 real invocations the failure path produced 76% of all
savings from 74% of the truncations; the reasoning and the break-even arithmetic
are in the skill.

It never makes context bigger, passing output through untouched when the
replacement would save less than 20%. Thresholds are constants at the top of
`plugins/context-trim/scripts/truncate-verbose-output.mjs`.

Its second hook logs every subagent call, which answers three otherwise invisible
questions: which agents you never actually use, how much context each delegation
hands back (an agent returning 4000+ chars is not distilling anything), and whether
nested delegation happens at all. Let it run a few days, then read the report:

```bash
node plugins/context-trim/scripts/report-metrics.mjs
```

The assumption that delegating beats reading inline might be wrong for your
workload, and this is how you find out.

### `code-graph`

Wires the external `code-review-graph` MCP server (MIT, Python,
https://github.com/tirth8205/code-review-graph) into delegated reads. It
parses a repo into a local SQLite graph — nodes are functions, classes and
imports, edges are calls, inheritance and test coverage — so "who calls this",
"what breaks if I change this" and "what tests cover this" become one
deterministic query instead of a grep sweep.

This pack does not install the CLI. `uv tool install code-review-graph` or
`pip install code-review-graph` has to happen first (Python 3.10 or newer),
then `code-review-graph build` in the project root builds the graph, or
`/code-graph:setup` walks through both steps. Never run
`code-review-graph install`: that is the upstream project's own installer, and
it rewrites the global MCP config and adds hooks this pack exists to avoid.

It ships `defaultEnabled: false`. Installing the pack is not the same as
turning it on — it depends on an executable only the user can install, so it
needs an explicit opt-in rather than working the moment it lands.

It also ships no hooks, a deliberate trade against the upstream project's own
`hooks.json`, which refreshes the graph on every `Write`/`Edit`/`Bash` call (a
30-second timeout each time) and injects `status` output at every session
start. This pack skips both: every edit stays fast and no session gets
unsolicited context, at the cost of a graph that can drift from the working
tree between refreshes. Refresh it with `/code-graph:refresh`, or let the
model call `build_or_update_graph_tool` itself, once a batch of edits
plausibly changed call graphs, imports or test coverage.

The upstream server exposes 30 MCP tools whose combined schema costs about
8,592 tokens — a figure the upstream author documents in the source itself —
sitting in every turn's system prompt for as long as the server stays
connected. This pack cuts that to 9 with a `--tools` allowlist. Two of the
removed tools, `apply_refactor_tool` and `refactor_tool`, are dropped as a
safety boundary rather than for size: a pack that is supposed to be a
read-only view of the code graph should not also be able to rewrite source
files. `embed_graph_tool` is dropped because it can trigger vector embeddings,
which may download a model or call out to the cloud.

Nothing in the default configuration needs an account, an API key, or makes a
network call — the base dependencies carry no HTTP client. The only paths that
do reach outward are opt-in: cloud embeddings require
`CRG_ACCEPT_CLOUD_EMBEDDINGS=1` set explicitly, the visualization falls back
to a D3.js CDN, and the first semantic search can pull a model from
HuggingFace; this pack's tool allowlist already excludes `embed_graph_tool`.
That does not make the graph private on its own: a query's *result* still
travels to Anthropic along with the rest of the context, the same as pasting
the source in directly — the net effect is less data leaving, not none.
`.code-review-graph/graph.db` is an unencrypted local database whose contents
are equivalent to your source structure; treat it like source and add it to
`.gitignore`.

The upstream project is honest about where it is weak, and that honesty
carries over here: its own semantic search sits around a 0.35 mean reciprocal
rank, flow/data-flow detection recall is about 33%, and impact analysis is
deliberately conservative, which means false positives are expected on a large
dependency graph. Reach for the graph on deterministic structural questions —
callers, blast radius, test coverage, cross-file inheritance — not on fuzzy
semantic search. It narrows where to look; it does not replace reading the
source.

Measured on this repository itself — 30 files, mostly Markdown and `.mjs` — a
build takes about 4 seconds and produces 371 nodes, 3,639 edges and a roughly
4.8MB database. Expect all three numbers to grow substantially on a larger
codebase.

### `claude-kit-meta`

Wraps this repository's own scripts as the slash commands listed under Usage.

---

## Maintaining this repository

An edit here reaches nobody until the version moves. Bump the pack's `version` in
`plugins/<pack>/.claude-plugin/plugin.json`, then:

```bash
node scripts/validate.mjs                                        # structure
node --test "plugins/**/tests/*.test.mjs" "tests/*.test.mjs"     # 187 tests
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
