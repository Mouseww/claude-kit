---
description: Install the fleet-engineering harness into the current repo (docs tree, evaluator, docs linter, hooks, CI, CODEOWNERS)
argument-hint: "[stack]  (omit to auto-detect; only 'dotnet' has a stack guide today)"
allowed-tools: Bash(python:*), Bash(git:*), Read, Write, Glob, Grep
---

Install the fleet-engineering methodology into this repository as committed files, so every
teammate and every agent session runs the same process version (Core Principle 12). This replaces
doing the six install steps by hand.

Stack override (may be empty): `$ARGUMENTS`

## Step 1: Detect stack

- If `$ARGUMENTS` is given, use it.
- Otherwise auto-detect: a `*.sln` or `**/*.csproj` at the repo root or one level down means
  `dotnet`.
- Only read `stacks/{stack}/references/project-initialization.md` if
  `stacks/{stack}/` actually exists in this skill. Today only `dotnet` ships a stack guide.
- No match, or the matched stack has no `stacks/{stack}/` directory: proceed stack-agnostically
  and say so explicitly in your response. Do not fabricate a stack guide and do not fail.

## Step 2: Create the docs tree

Create these directories if missing (do not touch files that already exist inside them):

```
docs/design-docs/
docs/product-specs/
docs/exec-plans/active/
docs/exec-plans/completed/
docs/tech-debt/
docs/quality/
docs/references/
```

## Step 3: Install the process templates

For each pair below, if the destination is **missing**, copy the template as-is. If the
destination **already exists**, show the user a diff and ask before overwriting; never overwrite
silently. This makes the command idempotent.

| Template | Destination |
|---|---|
| `templates/docs_lint.py.tpl` | `tools/docs_lint.py` |
| `templates/block-generated-docs.py.tpl` | `.claude/hooks/block_generated_docs.py` |
| `templates/settings.json.tpl` | `.claude/settings.json` |
| `templates/CODEOWNERS.tpl` | `CODEOWNERS` (repo root; if the platform is GitHub prefer `.github/CODEOWNERS`) |
| `templates/fleet-evaluator.md.tpl` | `.claude/agents/fleet-evaluator.md` |

For `.claude/settings.json`: if a settings file already exists, deep-merge the `hooks.PreToolUse`
entry from the template into it rather than overwriting the whole file, so existing hooks and
other settings survive.

If a `dotnet` stack was detected, also copy the CI template the user's platform needs from
`stacks/dotnet/templates/` (`ci-workflow.yml.tpl` for GitHub Actions at
`.github/workflows/ci.yml`, or `bitbucket-pipelines.yml.tpl` for Bitbucket at
`bitbucket-pipelines.yml`), plus `AGENTS.md.tpl`, `ARCHITECTURE.md.tpl`, `core-beliefs.md.tpl`,
`README.md.tpl` per `stacks/dotnet/references/project-initialization.md`. Ask the user which CI
platform they use if it is not obvious from existing files (`.github/` vs `bitbucket-pipelines.yml`).

## Step 4: Replace placeholders

In every file just installed, replace `{{ProjectName}}` with the repo's actual name (directory
name of the repo root, or ask the user if ambiguous). Leave every other `{{Placeholder}}` (e.g.
`{{TeamLead}}`, `{{Architect}}`, `{{OrdersOwner}}`) untouched: those need a real human name and
are not mechanically derivable.

## Step 5: Verify

Run:

```
python tools/docs_lint.py --fix
python tools/docs_lint.py --check
```

Report the `--check` result. If it fails, show the self-healing message it printed; do not try to
silence it by editing the generated files by hand.

## Step 6: Report

Tell the user, in one short summary:
- which stack was used (or "stack-agnostic" and why)
- which files were installed, which were skipped because they already existed, and which need a
  decision (settings.json merge, CODEOWNERS platform path, CI platform choice)
- which `{{Placeholder}}` values still need a human to fill in (team lead, architect, area owners)
- the result of `docs_lint.py --check`

Do not proceed past Step 3 into further development work in the same turn; installing the harness
is the whole scope of this command.
