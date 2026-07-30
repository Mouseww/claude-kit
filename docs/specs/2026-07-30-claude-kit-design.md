# claude-kit: a repository for accumulating Claude Code capabilities

Date: 2026-07-30
Status: implemented

## Problem

Capabilities kept accumulating in three incompatible shapes at once: a partial
plugin marketplace (`claude-kit/`, missing its manifest), a standalone package
with its own `install.ps1`/`install.sh` (`context-offload/`), and a zipped
Windows installer (`context-offload-installer/`). Each had a different install
story, none could be updated in place, and the same subagent definitions existed
in more than one of them.

What is needed is one repository that accumulates capabilities over time, with
one install command for a machine and one for a project.

## Decisions

### Distribution: plugin marketplace, not an install script

The repository is a Claude Code plugin marketplace: a root
`.claude-plugin/marketplace.json` listing packs under `plugins/`.

Rejected: a hand-written `install.ps1`/`install.sh` pair that copies files into
`~/.claude` or `./.claude`. It would give finer control over project-level
placement, but it means owning cross-platform install, update and uninstall
logic forever, and copied files cannot be updated in place. The marketplace
mechanism is native, gets update and enable/disable for free, and needs no
script at all.

Accepted cost: a marketplace is user-level. Project-level scoping needs a second
mechanism, below.

### Project level: write the project's own settings.json

`scripts/enable-in-project.mjs` writes two keys into the target project's
`.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": { "claude-kit": { "source": { "source": "directory", "path": "..." } } },
  "enabledPlugins": { "dev-agents@claude-kit": true }
}
```

That file is committed to the *project* repository, so everyone who clones it is
prompted to install the same set. No files are duplicated and updates follow the
marketplace.

Rejected: copying each pack's `skills/` and `agents/` into the project's
`.claude/`. Self-contained, but every pack exists in as many copies as projects
use it, and upgrading means re-copying everywhere.

Safety properties, in priority order:

1. Deep-merge; never drop a key the script did not add. On a scalar conflict the
   project's existing value wins unless `--force`, and every conflict is printed.
2. Timestamped `.bak` before overwriting an existing file.
3. `--dry-run` prints the resulting file plus an LCS line diff and writes nothing.

The diff is a real longest-common-subsequence diff rather than a set difference,
because the user is being asked to approve it. A set-based diff reports a line
whose only change is a trailing comma as one delete plus one insert, which reads
as if the value was touched.

### One node implementation per hook, no shell

Every hook entry point and repository script is a single `.mjs` run with `node`.

The previous arrangement carried a `.sh` and a `.ps1` per hook plus a
`hooks.windows-native.json` variant of each `hooks.json`. That is four artifacts
expressing one behaviour, and they drifted. Node is a dependency Claude Code
users effectively already have, and it buys identical behaviour on macOS, Linux
and native Windows plus `node --test`.

The port is behaviour-preserving. The `context-trim` regression suite (16 cases,
including the four bugs measured in the original v1, plus shape round-trips for
native, MCP and plain `tool_response`) was ported from python/bash to
`node --test` and passes. Two mechanisms from the old harness are gone because
they no longer apply: diffing a new bash script against an old one, and a fake
`PATH` simulating a missing `awk`.

CI runs on `ubuntu-latest` and `windows-latest`. A Linux-only matrix would not
catch a regression that reintroduces a POSIX assumption, which is the specific
failure this rule exists to prevent.

### Scope: migrate claude-kit only

The two existing packs (`context-trim`, `dev-agents`) move in. The 156 skills,
59 agents and 104 commands under `~/.claude` stay where they are; most are
supplied by third-party plugins and sorting authored content from vendored
content is a separate job.

## Structure

```
.claude-plugin/marketplace.json   manifest; every pack must be listed
plugins/<name>/                   one capability pack
  .claude-plugin/plugin.json      name == directory name
  skills/ agents/ commands/       whatever the pack ships
  hooks/hooks.json  scripts/      event wiring, node entry points
  tests/                          node --test
templates/plugin-template/        skeleton for a new pack
scripts/validate.mjs              structural validator, run by CI
scripts/enable-in-project.mjs     project-level installer
```

A pack is the unit of accumulation. Split into a new pack when someone would
plausibly want one without the other: `context-trim`'s truncation hooks are
useful whether or not you delegate to subagents, so they are separate from
`dev-agents`.

`claude-kit-meta` is a pack whose only job is managing the repository:
`/claude-kit-meta:install-here`, `:list`, `:new-plugin`.

### Validation

`scripts/validate.mjs` fails the build on: unparseable or incomplete
`marketplace.json`; a `source` that does not resolve to a directory containing
`plugin.json`; a `plugin.json` `name` that disagrees with its directory or with
the marketplace entry; a directory under `plugins/` that is not listed; missing
`name`/`description` frontmatter in skills, agents or commands; a `SKILL.md`
`name` that disagrees with its directory; a `hooks.json` referencing a file that
does not exist; and any hook command invoking a shell script.

The dangling-hook check earns its place: a hook command pointing at a missing
file fails silently on every single tool call, with no error surfaced anywhere.
It caught a real instance during implementation.

### Found during implementation: dev-agents shipped an empty skill

`plugins/dev-agents/skills/dev-agents/` was an empty directory while
`plugin.json` claimed the pack "includes a delegation strategy skill". The skill
text existed only in the old standalone `context-offload/` package, written
against an install mechanism (`install.sh`, `settings-snippet.json`) that no
longer applies. Git does not track empty directories, so the gap was invisible in
review as well as at runtime.

It was rewritten for the plugin form and now ships. The validator gained two
checks so the class of bug cannot recur: a `skills/`, `agents/` or `commands/`
directory containing nothing is an error, and a subdirectory of `skills/` without
a `SKILL.md` is an error.

### Also restored: the task-plan hook pair

`track-task-plan` and `require-task-plan` existed only in the old standalone
package and were never wired into the plugin, so the skill text referenced two
hooks that did not ship. Ported to node and registered. Two deliberate
deviations from the bash originals:

- The session id is sanitized before being used in a filename. The original
  interpolated it raw, so an id containing a path separator would have written
  outside the state directory. There is a test for this.
- The reminder is throttled to the first planless dispatch and then every third.
  The original fired on *every* planless `Agent` call, which nags a legitimate
  one-shot delegation every single time. `REPEAT_EVERY = 1` restores the old
  behaviour.

`require-task-plan` emits `additionalContext` under a PreToolUse
`hookSpecificOutput`, which is documented for UserPromptSubmit and PostToolUse
but unverified for PreToolUse. This is the same class of uncertainty as
`updatedToolOutput` in `truncate-verbose-output.mjs`, and it is handled the same
way: the assumption is stated in the header with a 30-second procedure to check
it, rather than left implicit. Escalating to `permissionDecision: "deny"` was
rejected — blocking a dispatch over a missing task list trades a small context
loss for a hard failure, and the hook cannot tell a one-step delegation from a
ten-step one.

## Known limits

- `enable-in-project.mjs` defaults the marketplace source to this working copy's
  absolute path, which is correct for one machine and wrong for a team. Teams
  pass `--source git --url <url>`. Making that the default requires a remote
  that does not exist yet.
- `--remove` disables plugins for a project but cannot distinguish a plugin the
  script enabled from one enabled by hand. It removes by name either way.
- Skills, agents and commands are validated structurally, not semantically.
  Nothing checks that a description is actually useful.
