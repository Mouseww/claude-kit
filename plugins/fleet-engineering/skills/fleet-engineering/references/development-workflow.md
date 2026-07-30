# Development Workflow

> The lifecycle of a feature from idea to shipped code, in a team repository.

## Feature Lifecycle

```
1. Pre-flight       ->  Check claims of active plans on main
2. Product Spec     ->  Define WHAT to build
3. Design Doc       ->  Define HOW to build it
4. Execution Plan   ->  Define WHEN, and CLAIM what it touches
        |
   DOCS-FIRST PR    ->  Docs merge to main BEFORE code starts
        |
5. Implementation   ->  Code follows the plan, inside its claims
6. Quality Audit    ->  fleet-evaluator must PASS
        |
   CODE PR          ->  Human review; CI doc gates enforce the above
```

Not every change needs all steps:

| Change Type | Steps Needed |
|-------------|-------------|
| New feature (significant) | All steps |
| Enhancement | Spec update + Plan + Docs PR + Implementation + Audit |
| Bug fix | Implementation + Audit (+ spec update in same PR if behavior changes) |
| Refactoring | Design doc via Docs PR (if architectural) + Implementation + Audit |
| Configuration change | Implementation only |

## File Path and Identity Conventions

| Document Type | Path Pattern |
|---------------|-------------|
| Product Spec | `docs/product-specs/{feature-name}.md` |
| Design Doc | `docs/design-docs/{feature-name}.md` |
| Execution Plan (active) | `docs/exec-plans/active/{TICKET}-{slug}.md` |
| Execution Plan (completed) | `docs/exec-plans/completed/{TICKET}-{slug}.md` |
| Tech Debt entry | `docs/tech-debt/TD-{TICKET}.md` (suffix `-a`, `-b` if several per ticket) |
| Quality area | `docs/quality/{area}.md` |
| Index pages + QUALITY_SCORE.md | GENERATED. Never create or edit by hand; run `python tools/docs_lint.py --fix` |

`{TICKET}` is the ticket-system ID (e.g. `PIEX-5336`). No ticket system: use `{YYYYMMDD}-{author}-{slug}`. Never invent sequential numbers; two teammates counting files will pick the same number.

Branch conventions: `docs/{TICKET}-{slug}` for docs-first PRs, `feature/{TICKET}-{slug}` for implementation (CI extracts the ticket to verify an Active plan exists on main).

## Step 0: Pre-flight

1. `git fetch`; read `docs/exec-plans/active/` as it exists ON MAIN
2. Compare your intended scope with every active plan's `claims` frontmatter (`tools/docs_lint.py --check` reports overlaps)
3. Overlap? STOP and surface to the humans involved. See `collaboration-controls.md` Control 2.

## Step 1: Product Specification

**Template**: `product-spec.md.tpl` -> `docs/product-specs/{feature-name}.md`

Defines: glossary, user workflow, functional requirements (F1.1 format), non-functional requirements, acceptance criteria (AC1, "When X then Y" format). Acceptance criteria are the contract between spec and implementation.

Frontmatter status starts at `Draft`, becomes `In Review` when the docs PR opens, `Approved` when it merges.

## Step 2: Design Document

**Template**: `design-doc.md.tpl` -> `docs/design-docs/{feature-name}.md`

Defines: domain model, processing pipeline, layer responsibilities, configuration, alternatives considered. The data flow example is the most valuable section for implementing agents.

## Step 3: Execution Plan

**Template**: `execution-plan.md.tpl` -> `docs/exec-plans/active/{TICKET}-{slug}.md`

Defines: phases with dependencies, deliverables per phase, acceptance criteria per phase, risk register, external dependencies, and the **Claims** frontmatter (code and docs globs this plan will touch). Claims are the team's coordination lock; see `collaboration-controls.md`.

## Docs-first PR (between Step 3 and Step 4)

1. `python tools/docs_lint.py --fix` (regenerate indexes), then `--check`
2. Open a docs-only PR from `docs/{TICKET}-{slug}` to main
3. Reviewers: doc owners (CODEOWNERS routes automatically) + owners of any overlapping claims
4. On merge: spec/design status -> `Approved`, plan status -> `Active`
5. **Implementation must not start before this merge.** User-authorized waivers are logged as tech debt.

## Step 4: Implementation

1. Branch `feature/{TICKET}-{slug}` from current main
2. Follow the plan phase by phase; start a phase only when its dependencies are met; check off deliverables as completed
3. Stay inside the plan's claims; touching outside requires amending the Claims section first
4. After each phase: format check, build with warnings-as-errors, full test run (incl. architecture tests)
5. Update docs if implementation deviates from plan (same branch, evaluator will check consistency)
6. Rebase on main before the audit and re-run `docs_lint.py --check`

## Step 5: Post-Implementation Audit - MANDATORY

**Not optional, and not performed by the implementing agent.** Delegated to the `fleet-evaluator` subagent defined in the repo at `.claude/agents/fleet-evaluator.md`.

**5.1 - Bookkeeping first:**

1. Mark deliverables and acceptance criteria `[x]` in the exec plan
2. Plan fully done? Status -> `Completed`, move to `docs/exec-plans/completed/`
3. Update design doc / product spec if interfaces, models, or behavior changed
4. Update or create `docs/quality/{area}.md` for every affected area
5. Create `docs/tech-debt/TD-{TICKET}*.md` for shortcuts taken
6. `python tools/docs_lint.py --fix && python tools/docs_lint.py --check`

**5.2 - Spawn the evaluator** (`subagent_type: "fleet-evaluator"`, or `"fleet-engineering:fleet-evaluator"` when it comes from the installed pack rather than the repo) with: change type, exec plan path, design doc path, spec path, changed file list, round number, and previous findings + responses when round > 1.

**5.3 - Audit Protocol loop** (full spec in `SKILL.md`): Fix / Rebut-with-evidence / Defer-with-doc-update per finding; max 3 rounds; PASS requires zero BLOCKER/MAJOR; never self-declare PASS.

> **Why mandatory**: passing tests mean the code works; updated docs mean the next agent or
> teammate can understand it; the independent evaluator catches silent drift between the two.
> In a team the cost of drift is multiplied by every person who reads the stale doc.

## Code PR

Before opening:

- [ ] Evaluator verdict PASS (or user-authorized skip logged in tech debt)
- [ ] Build passes with warnings-as-errors; all tests pass; format passes
- [ ] `docs_lint.py --check` passes
- [ ] PR description contains: ticket, link to exec plan, evaluator summary (rounds + deferred findings)
- [ ] PR is a single logical unit (one phase = one PR is the default)
- [ ] No secrets in code

CI enforces: format/build/test, architecture tests, docs lint, and the plan-reference gate (a `feature/{TICKET}-*` branch must match an `Active` plan on the target branch).

The human PR reviewer is the final gate. Evaluator PASS is evidence for the reviewer, not a substitute.

## Commit Message Convention

Conventional commit style; include the ticket:

```
feat(PIEX-5336): add Order entity with validation invariants
fix(PIEX-5410): handle null response from external service
docs(PIEX-5336): exec plan + design doc for auto-archive
```

## When to Update Documentation

| Event | Update |
|-------|--------|
| New feature started | Spec + design + plan via docs-first PR |
| Architecture decision made | Design doc (docs PR) |
| Phase completed | Check off deliverables; bump `updated` in frontmatter |
| Scope changed mid-implementation | Amend Claims section before touching new paths |
| Shortcut taken | New `docs/tech-debt/TD-*.md` entry |
| Tech debt resolved | Set `resolved` + `pr` in the entry's frontmatter |
| Audit done | Update `docs/quality/{area}.md`; dashboard regenerates |
| Feature shipped | Plan to `completed/`, status `Completed` |
| Anything above | `python tools/docs_lint.py --fix` before committing |
