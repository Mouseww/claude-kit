# claude-kit

A personal Claude Code capability repository: skills, subagents, slash commands
and hooks, packaged as installable plugins and served through a plugin
marketplace manifest.

The point is accumulation. Anything worth reusing goes in here as a **capability
pack**, and installing it anywhere is one command.

## What is in here

| Plugin | Ships | What it does |
|---|---|---|
| `claude-kit-meta` | 3 commands | Install and manage claude-kit itself |
| `context-trim` | 1 skill, hooks | Truncates long command output before it reaches the model; logs per-subagent cost |
| `dev-agents` | 10 agents, hooks | Role-bound subagents with the model tier fixed per role, plus a delegation nudge |

```bash
node scripts/enable-in-project.mjs --list
```

## Install

### User level — available in every project

In any Claude Code session:

```
/plugin marketplace add C:/Users/webber_wei/projects/claude-kit
```

then

```
/plugin install dev-agents@claude-kit
```

Once this repository lives on a remote, the same command takes the URL instead
of the local path. Nothing inside the repository has to change.

### Project level — the project asks for it

A marketplace is a user-level thing. Making a plugin part of a *project* means
two keys in that project's own `.claude/settings.json`, committed to the project
repository, so everyone who clones it gets prompted to install the same set.

From inside the target project, with `claude-kit-meta` installed:

```
/claude-kit-meta:install-here dev-agents,context-trim
```

Or directly, no plugin needed:

```bash
node C:/Users/webber_wei/projects/claude-kit/scripts/enable-in-project.mjs --project . --plugins dev-agents,context-trim --dry-run
```

Drop `--dry-run` to apply. The script deep-merges into any existing settings,
never removes a key it did not add, and writes a timestamped `.bak` first.

Useful flags:

| Flag | Effect |
|---|---|
| `--list` | Show available plugins and what each ships |
| `--dry-run` | Print the resulting file and the diff, write nothing |
| `--remove` | Disable the named plugins for that project |
| `--force` | Overwrite conflicting existing values (off by default) |
| `--source git --url <url>` | Register a remote marketplace instead of this directory |

## Requirements

`node` on `PATH`. That is the whole list. Every hook and script in this
repository is a single `.mjs` file, so macOS, Linux and native Windows run
identical code; there are no `.sh`/`.ps1` pairs to keep in sync and no `jq` or
`awk` dependency.

## Adding a capability

```
/claude-kit-meta:new-plugin <name> <one-line description>
```

or by hand, which is four steps: copy `templates/plugin-template/`, fill in
`plugin.json`, add an entry to `.claude-plugin/marketplace.json`, run the
validator. `CONTRIBUTING.md` is the authority on layout and the rules the
validator enforces.

## Checks

```bash
node scripts/validate.mjs                                       # structure
node --test plugins/context-trim/tests/truncate.test.mjs        # unit tests
```

Both run in CI on every push.

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
