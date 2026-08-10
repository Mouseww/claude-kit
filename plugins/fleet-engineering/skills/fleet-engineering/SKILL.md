---
name: fleet-engineering
disable-model-invocation: true
description: |
  Fleet engineering methodology: agent-first development for TEAMS, with mechanical enforcement
  and conflict-free-by-construction collaboration. The team-scale evolution of harness-engineering
  (which remains the solo/personal-project skill).
  Use this skill when: working in a team repository that follows fleet engineering (look for
  AGENTS.md + .claude/skills/fleet-engineering in the repo), initializing a new TEAM project,
  writing product specs, design docs, execution plans, tech debt entries, or quality scores in a
  team context; setting up docs linting, CODEOWNERS, claims-based work coordination, docs-first
  PRs, or CI doc gates. Also use when the user requests feature development, bug fixes,
  enhancements, or refactoring in a fleet engineering project.
  Trigger on: "fleet engineering", "team project", "team harness", "docs-first PR", "claims",
  "doc conflict", "docs linter", "new team project", "product spec", "design doc",
  "execution plan", "tech debt", "quality score", "AGENTS.md", "add feature", "implement",
  "fix bug", "enhance", "refactor", "development request" when the project is shared by a team.
---

# Fleet Engineering

Fleet engineering is **agent-first development at team scale**. It extends harness engineering (the solo methodology) with one additional design goal: **multiple humans, each with their own agents, working in parallel branches must not corrupt each other's work, code or docs.**

The core insight: a solo harness assumes a single writer working serially. A team breaks that assumption everywhere it was silently relied on: sequential file numbering, hand-edited index files, single dashboard files, advisory "check for conflicts" steps, and process docs living on one person's machine. Fleet engineering removes every single-writer assumption by construction:

1. **No invented identifiers**: all IDs come from the ticket system (globally unique by definition), never from counting files in a directory.
2. **No hand-edited aggregate files**: indexes and dashboards are GENERATED from per-document frontmatter; CI fails if they are stale; hand-editing them is mechanically blocked.
3. **No invisible work**: specs, designs, and plans land on the main branch via a docs-first PR BEFORE implementation starts. The merged plan, with a machine-readable Claims section, is the coordination lock.
4. **No process drift**: the skill, the evaluator agent, the docs linter, hooks, and CODEOWNERS are all version-controlled IN the project repo. Process changes go through PR review like code.

**This methodology is language-agnostic.** Stack-specific guidance lives in `stacks/{stack}/`.

## Step Zero: Read the Project's AGENTS.md

**Every request** must begin with this decision:

1. Check if `AGENTS.md` exists in the project root
2. **If it exists**: Read it first, follow its links to understand current state before any task.
3. **If it does NOT exist**: The project needs initialization. Go to "Project Initialization" below.

This is non-negotiable. AGENTS.md is the progressive disclosure entry point.

## Core Principles

All eight harness-engineering principles still apply (repo as system of record, mechanical enforcement, self-healing errors, progressive disclosure, golden rules, boring technology, feedforward/feedback controls, drift cleanup; see `principles/`). Fleet engineering adds four team principles:

9. **Conflict-free by construction** - Shared files that every feature must touch are a design defect. Eliminate them (ticket IDs, per-entry files) or generate them (indexes, dashboards). See `references/docs-automation.md`.
10. **Main is the only truth** - A doc on a feature branch does not exist for the rest of the team. Specs, designs, and plans merge to main via a docs-only PR before implementation begins. See `references/collaboration-controls.md`.
11. **Claims are locks** - Every execution plan declares the code paths and docs it will touch. CI warns on overlap between active plans. Humans arbitrate overlaps; agents never silently proceed into claimed territory. See `references/collaboration-controls.md`.
12. **The process is in the repo** - `.claude/skills/`, `.claude/agents/fleet-evaluator.md`, `tools/docs_lint.py`, hooks, and CODEOWNERS are committed and reviewed. Everyone runs the same process version, or the process itself drifts.

## Quick Reference

### "I want to..."

| Task | Action |
|------|--------|
| **Add a feature / enhancement / bug fix / refactor** | Follow "Development Request Procedure" below |
| **Start a new team project** | Detect stack, read `stacks/{stack}/references/project-initialization.md` |
| **Understand team coordination (claims, docs-first PR, ownership)** | Read `references/collaboration-controls.md` |
| **Set up / understand docs automation (generated indexes, linter)** | Read `references/docs-automation.md` |
| **Understand the dev workflow** | Read `references/development-workflow.md` |
| **Write a product spec / design doc / exec plan** | Templates in `templates/` |
| **Track tech debt** | One file per entry: `templates/tech-debt-entry.md.tpl` |
| **Run quality audit** | Read `templates/quality-area.md.tpl` |
| **Set up golden rules / code quality / CI / architecture tests** | Read `references/golden-rules.md` + `stacks/{stack}/references/` |
| **Install the evaluator agent** | Already available as `fleet-engineering:fleet-evaluator` if you installed this as a plugin. For a team repo, still copy `templates/fleet-evaluator.md.tpl` to `.claude/agents/fleet-evaluator.md` so everyone audits against the same version |

## Document Identity Rules (Layer 1: conflict elimination)

These rules exist because two people creating documents on the same day must never collide.

| Rule | Wrong (harness, solo) | Right (fleet, team) |
|------|----------------------|---------------------|
| Exec plan naming | `docs/exec-plans/active/014-foo.md` | `docs/exec-plans/active/{TICKET}-{slug}.md` e.g. `PIEX-5336-auto-archive.md` |
| Tech debt ID | `TD-014` sequential in one file | One file per entry: `docs/tech-debt/TD-{TICKET}.md` (suffix `-a`, `-b` for multiple per ticket) |
| Index pages | Hand-edited `index.md` | GENERATED by `tools/docs_lint.py --fix`; never hand-edit |
| Quality dashboard | Single hand-edited `QUALITY_SCORE.md` | Per-area files `docs/quality/{area}.md`; `docs/QUALITY_SCORE.md` is GENERATED |
| No ticket system? | n/a | Fallback ID: `{YYYYMMDD}-{author}-{slug}` |

Every document carries YAML frontmatter (type, title, status, owner, ticket, created, updated). The frontmatter is the machine-readable source for all generated files. See `references/docs-automation.md` for the full schema.

## Development Request Procedure

### 1. Read AGENTS.md and run the pre-flight check

- Read `AGENTS.md` (done via Step Zero)
- `git fetch` and check `docs/exec-plans/active/` ON MAIN, not just your branch
- Compare your intended scope against the **Claims** sections of all active plans. If your work overlaps another active plan's claims, STOP and surface the overlap to the user. A human decides: coordinate, re-scope, or proceed with explicit acknowledgment. Never silently proceed.

### 2. Classify the change type

| Change Type | Required Steps |
|-------------|---------------|
| New feature (significant) | Spec -> Design -> Plan -> **Docs PR to main** -> Implement -> Audit -> Code PR |
| Enhancement to existing | Spec update -> Plan -> **Docs PR** -> Implement -> Audit -> Code PR |
| Bug fix | Implement -> Audit -> Code PR (+ spec update in the same PR if behavior changes) |
| Refactoring | Design doc (if architectural, via Docs PR) -> Implement -> Audit -> Code PR |
| Configuration change | Implement -> Code PR |

> **A "phase" is a development request.** When an exec plan has multiple phases and the user
> says `go` / `continue` / `next phase`, each phase runs its own Step E audit. One audit per
> phase; never batch audits to the end of the plan.

### 3. Docs-first PR (Layer 2: coordination through main)

For changes that require a spec, design doc, or exec plan:

1. Author the docs on a short-lived branch (`docs/{TICKET}-{slug}`), status `In Review`
2. Run `tools/docs_lint.py --fix` (regenerates indexes), then `--check`
3. Open a **docs-only PR** to main. Reviewers: the doc owners per CODEOWNERS + anyone whose active plan's claims overlap yours
4. On merge, set status to `Approved` (specs/designs) / `Active` (exec plan). The plan on main is now visible to the whole team and its Claims section acts as a soft lock
5. **Hard gate: implementation (Step D) must not start while the spec/design status is `Draft` or `In Review`.** If the user explicitly waives the docs PR (urgent fix), record the waiver as a tech debt entry, same script as an audit skip.

### 4. Implementation (Step D)

- Branch naming: `feature/{TICKET}-{slug}` (CI uses the ticket to find your active plan)
- Follow the exec plan phase by phase; stay inside your declared claims. If you must touch files outside your claims, update the Claims section first (small docs commit) so the lock reflects reality
- After each phase run format, build (warnings-as-errors), and tests
- Rebase on main before the audit; doc conflicts must be resolved BEFORE the evaluator runs, not after

### 5. Step E: Post-Implementation Audit - MANDATORY

> **Three distinct roles - do not collapse them.**
> 1. **Implementer (you, the main agent)**: wrote the code; biased toward declaring victory; not allowed to be the auditor.
> 2. **Evaluator subagent (`fleet-evaluator`)**: independent adversarial reviewer, defined IN THE REPO at `.claude/agents/fleet-evaluator.md`; runs automatically as part of every Step E; must return `verdict: PASS` before a code PR is opened.
> 3. **PR reviewer (human teammate)**: final approver. Evaluator PASS is the precondition for opening the PR, not a replacement for human review.

**E.1 - Bookkeeping first** (so the evaluator has artifacts to check):

1. Mark completed deliverables and acceptance criteria `[x]` in the exec plan
2. If the whole plan is done: status -> `Completed`, move file to `docs/exec-plans/completed/`
3. Update design doc / product spec if interfaces, models, or behavior changed
4. Update or create `docs/quality/{area}.md` for every affected area (score + date + evidence)
5. Create `docs/tech-debt/TD-{TICKET}*.md` entries for any shortcuts taken
6. Run `tools/docs_lint.py --fix` then `--check`: indexes and dashboard regenerate from your frontmatter; the linter catches claims violations, stale statuses, and broken links

**E.2 - Spawn the `fleet-evaluator` subagent** via the `Agent` tool with `subagent_type: "fleet-evaluator"`, falling back to `subagent_type: "fleet-engineering:fleet-evaluator"` when the project has no committed `.claude/agents/fleet-evaluator.md` and the evaluator comes from the installed pack instead. The spawn prompt MUST include: change type, exec plan path, design doc path, spec path, list of changed files, round number, and (round > 1) previous findings with your rebuttal/fix for each.

**Audit Protocol loop** (same as harness engineering): per finding choose Fix / Rebut-with-evidence / Defer-with-doc-update, then re-spawn with round+1. Max 3 rounds, then surface to user. `PASS` requires zero BLOCKER and zero MAJOR findings. The main agent never overrides a BLOCKER. Two identical consecutive FAIL rounds also stop the loop.

**User-authorized skip**: only the user may waive the audit. Acknowledge in chat, log a `docs/tech-debt/TD-{TICKET}-audit-skip.md` entry, surface it in the same response. Never propose the skip yourself.

### 6. Code PR (the human gate)

- Open the PR only after evaluator PASS. Include in the PR description: ticket, exec plan link, evaluator verdict summary (round count + deferred findings)
- CI runs: format, build (warnings-as-errors), tests + architecture tests, `docs_lint.py --check`, and the plan-reference gate (implementation branches must reference an `Active` exec plan on main; see `stacks/{stack}/templates/ci-workflow.yml.tpl`)
- CODEOWNERS routes doc changes to doc owners: a human arbitrates semantic doc conflicts that git cannot see

### 7. Definition of Done

- [ ] Build passes with warnings-as-errors
- [ ] All tests pass (including architecture tests)
- [ ] Formatting passes; no architecture violations
- [ ] `tools/docs_lint.py --check` passes (frontmatter valid, indexes fresh, links resolve, claims consistent)
- [ ] Exec plan deliverables `[x]`; plan moved to `completed/` if fully done
- [ ] Design doc and product spec reflect what was actually built
- [ ] `docs/quality/{area}.md` updated for affected areas (dashboard regenerates)
- [ ] Tech debt entries created for shortcuts
- [ ] Evaluator verdict: PASS (or user-authorized skip logged as tech debt)
- [ ] No secrets in code

## Project Initialization

1. **Detect the stack**, read `stacks/{stack}/references/project-initialization.md`
2. Scaffold code structure per the stack guide
3. Create the docs hierarchy (note the fleet-specific dirs):

```
docs/
├── design-docs/        (+ generated index.md)
├── product-specs/      (+ generated index.md)
├── exec-plans/
│   ├── active/         (+ generated index.md at exec-plans/index.md)
│   └── completed/
├── tech-debt/          one file per entry (+ generated index.md)
├── quality/            one file per area
├── references/
└── QUALITY_SCORE.md    GENERATED dashboard
```

4. **Commit the process into the repo (Layer 4)**:
   - Copy this skill into `{repo}/.claude/skills/fleet-engineering/`
   - Copy `templates/fleet-evaluator.md.tpl` -> `{repo}/.claude/agents/fleet-evaluator.md`
   - Copy `templates/docs_lint.py.tpl` -> `{repo}/tools/docs_lint.py`
   - Copy `templates/settings.json.tpl` -> `{repo}/.claude/settings.json` (includes the hook that blocks hand-edits to generated files)
   - Copy `templates/block-generated-docs.py.tpl` -> `{repo}/.claude/hooks/block_generated_docs.py`
   - Copy `templates/CODEOWNERS.tpl` -> `{repo}/CODEOWNERS` (or `.bitbucket/`, `.github/` per platform) and assign real owners
5. Apply document templates (`templates/*.tpl`, `{{ProjectName}}` placeholder) and stack templates (`stacks/{stack}/templates/`)
6. Run `tools/docs_lint.py --fix` to generate all indexes, then verify `--check` passes

## Layered Architecture

Unchanged from harness engineering: strict layered architecture, dependencies flow inward, innermost layer has zero external dependencies, interfaces inward / implementations outward, provider pattern for cross-cutting concerns, violations enforced by architecture tests. See `stacks/{stack}/references/architecture-rules.md`.

## Templates

**Document templates** (`templates/`):
- `product-spec.md.tpl`, `design-doc.md.tpl`, `execution-plan.md.tpl` (with frontmatter + Claims)
- `tech-debt-entry.md.tpl` (one file per entry)
- `quality-area.md.tpl` (per-area score file)
- `design-docs-index.md.tpl`, `product-specs-index.md.tpl` (initial generated-file stubs)

**Team infrastructure templates** (`templates/`):
- `fleet-evaluator.md.tpl` - the evaluator agent definition, checked into repo `.claude/agents/`
- `docs_lint.py.tpl` - docs linter + index generator, checked into repo `tools/`
- `settings.json.tpl` + `block-generated-docs.py.tpl` - shared Claude Code settings + hook
- `CODEOWNERS.tpl` - doc/code ownership routing

**Stack templates** (`stacks/{stack}/templates/`): AGENTS.md, ARCHITECTURE.md, README.md, core-beliefs, CI workflow (with docs gates).

## Composing with Other Skills

Fleet engineering is a **process skill**: it governs stages, gates, and audits. It is designed to compose with **domain skills** (project-specific skills that teach how to write a particular kind of code or artifact, e.g. a repair-handler skill, a DTO-generation skill, a PR-review skill). Loading additional skills during a development request is normal and encouraged.

**Composition rules:**

1. **Declare, don't hope.** Skill triggering mid-implementation is unreliable; an agent deep in a plan may not think to load the module's skill. So the exec plan template has a **Relevant Skills** section: at planning time, check the repo's AGENTS.md Module Skills Map and `.claude/skills/`, and declare which skill applies to which phase. The implementer loads them when entering that phase.
2. **Precedence on conflict.** Fleet engineering wins on WORKFLOW (stages, docs-first gate, claims, audit, DoD); the domain/project skill wins on MECHANICS (code patterns, file conventions, commit/PR formats, tool invocations). Example: if a project git-push skill mandates a specific commit message template, use that template; fleet's commit examples are defaults, not gates. If a genuine contradiction touches a gate (e.g. a skill says "push directly to main"), STOP and surface it to the user; never silently pick.
3. **Domain skills also live in the repo.** Team-shared domain skills belong in `{repo}/.claude/skills/` next to this one (Layer 4 applies to them too), and get a row in AGENTS.md's Module Skills Map so planning agents can discover them.
4. **Subagents do not inherit your loaded skills.** The `fleet-evaluator` runs in its own context: it cannot see domain-skill instructions loaded in the main conversation. If verifying a deliverable requires domain knowledge (e.g. "every repair handler must be registered in the chain"), encode that as a checkable acceptance criterion in the exec plan, or state it explicitly in the evaluator spawn prompt.

## Relationship to harness-engineering

| Concern | harness-engineering (solo) | fleet-engineering (team) |
|---------|---------------------------|--------------------------|
| Writers | One person + agent, serial | Many people + agents, parallel |
| Doc IDs | Sequential NNN | Ticket IDs |
| Indexes/dashboard | Hand-edited | Generated, CI-checked, edit-blocked |
| Coordination | Advisory check of active/ | Claims on main + docs-first PR + CI gates |
| Approval | The user is the approver | Doc owners + PR reviewers; evaluator PASS gates the PR |
| Process location | User's machine | Committed in the repo |

Use harness-engineering for personal projects. Use fleet-engineering when more than one person commits to the repo.
