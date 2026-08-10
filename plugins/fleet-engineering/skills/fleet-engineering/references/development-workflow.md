# Development Workflow

> The lifecycle of a feature from idea to shipped code, in a team repository.

## Feature Lifecycle

```
0. Pre-flight       ->  Scan remote branches + open PRs for claims overlap (Step 0, before any doc is written)
1. Product Spec     ->  Define WHAT to build           |
2. Design Doc       ->  Define HOW to build it         |  same branch,
3. Execution Plan   ->  Define WHEN, and CLAIM it       |  authored before
        |                                               |  implementation
   docs committed, status: In Review                    |  starts (R5)
        |
4. Implementation   ->  Code follows the plan, inside its claims
                        Design wrong or unworkable? -> Design Change path (see below)
5. Quality Audit    ->  fleet-evaluator must PASS (layered DoD, see Step 5)
        |
   ONE PR            ->  docs + code together; human review; CI doc gates enforce the above
```

There is no separate docs-first PR to main. Docs and code ship in the same branch and the
same PR (R5). What used to be enforced by merging docs to main first is now enforced by
commit ordering on the branch: doc commits before the first implementation commit, and by
Step 0 reading claims from remote branches and open PRs instead of from main.

Not every change needs all steps. Which steps a change needs is no longer a self-declared
call: the agent must declare the five R2 signals (S1-S5, see "Change Classification" below),
and the evaluator recomputes them from the diff.

## Change Classification (R2)

The agent classifies the change, but the classification is no longer taken on
trust: it must be backed by five mechanically derivable signals, and the evaluator
independently recomputes them from `git diff origin/main...HEAD`.

| ID | Signal |
|----|--------|
| S1 | Adds or changes a public interface: exported symbol, HTTP endpoint, CLI flag, message/event contract |
| S2 | Changes a persistence or wire model: DB schema, migration, serialization format |
| S3 | Adds a new external dependency |
| S4 | Net added lines in non-test, non-doc files exceeds 150 |
| S5 | Changes behaviour that an existing product spec describes |

Routing. Three tiers, named identically to the DoD tiers below, one-to-one. Read the table top
down and take the first row that matches, so a change with S1 true and S4 true is Full, not
Design.

| Tier | Condition | Required artifacts |
|------|-----------|--------------------|
| **Core** | S1-S5 all false | none. Implement, audit, PR. |
| **Design** | S1, S2, or S3 true, and both S4 and S5 false | Design doc |
| **Full** | S4 or S5 true | Design doc + exec plan, plus product spec when S5 is true |

Record the five signal values in the PR description, and in the exec plan if one exists.
The evaluator recomputes all five from the diff during the audit (Step 5). Any mismatch
between declared and recomputed signals is a **MAJOR** finding, regardless of what the
recomputed route would have required. This is what makes the classification independently
reviewable instead of self-adjudicated.

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

Branch conventions: one branch per change, `feature/{TICKET}-{slug}` (or `fix/{TICKET}-{slug}`
for bug fixes; the gate that used to depend on this prefix now fires on diff content, not on
the name, see R3). Docs and code both live on this branch; there is no separate `docs/*`
branch.

## Step 0: Pre-flight

Conflict detection runs here, before any document is written, and never depends on main
being writable directly.

1. `git fetch --all --prune`
2. Enumerate `origin/*` branches; for each, read `docs/exec-plans/active/*.md` present on
   that branch. Where a PR host CLI is available (e.g. `gh pr list`), also enumerate open
   PRs and their exec plans.
3. Two-stage comparison against your intended scope, cheap first:
   - **Coarse**: reduce every discovered plan's `claims.code` globs, and your own intended
     scope, to their first two path segments. Compare at that granularity.
   - **Fine**: only for a coarse hit, do the full glob overlap comparison.
4. Overlap? STOP and surface to the humans involved. See `collaboration-controls.md`
   Control 2. The agent never arbitrates this and never proceeds silently.
5. No exec plans discoverable anywhere (fresh project, no remote history)? Report conflict
   detection as "not available" and continue; this is not a hard failure.

## Step 1: Product Specification

**Template**: `product-spec.md.tpl` -> `docs/product-specs/{feature-name}.md`

Defines: glossary, user workflow, functional requirements (F1.1 format), non-functional requirements, acceptance criteria (AC1, "When X then Y" format). Acceptance criteria are the contract between spec and implementation.

Frontmatter status starts at `Draft` while the doc is being written, becomes `In Review` once
the doc is complete and committed to the branch (implementation may begin at this point, see
Step 4), and becomes `Approved` when the human PR reviewer approves the PR, or when merge
automation sets it. The agent never sets `Approved` on itself.

## Step 2: Design Document

**Template**: `design-doc.md.tpl` -> `docs/design-docs/{feature-name}.md`

Defines: domain model, processing pipeline, layer responsibilities, configuration, alternatives considered. The data flow example is the most valuable section for implementing agents.

## Step 3: Execution Plan

**Template**: `execution-plan.md.tpl` -> `docs/exec-plans/active/{TICKET}-{slug}.md`

Defines: phases with dependencies, deliverables per phase, acceptance criteria per phase, risk register, external dependencies, and the **Claims** frontmatter (code and docs globs this plan will touch). Claims are the team's coordination lock; see `collaboration-controls.md`.

## In-branch doc checkpoint (between Step 3 and Step 4)

There is no separate docs-only PR to main (R5). Instead, the branch itself carries the
ordering, and the evaluator checks it later:

1. `python tools/docs_lint.py --fix` (regenerate indexes), then `--check`
2. Commit spec/design/plan on the same branch that will carry the implementation, with status
   `In Review`. These commits must land before the first implementation commit.
3. **Implementation must not start while any required document's status is `Draft`.**
   `In Review` is the working state for the implementation phase; it is not a blocker.
4. CODEOWNERS still routes doc owners onto the eventual PR (there is only one PR now, so this
   is the mechanism by which doc owners see the change at all).
5. `Approved` is set later, by the human PR reviewer or by merge automation, not by the agent.

## Step 4: Implementation

1. Continue on the same branch that carries the docs; do not open a second branch or a second PR.
2. Follow the plan phase by phase; start a phase only when its dependencies are met; check off deliverables as completed
3. Stay inside the plan's claims; touching outside requires amending the Claims section first
4. After each phase: format check, build with warnings-as-errors, full test run (incl. architecture tests)
5. Before a change that crosses layer boundaries, read
   `stacks/{stack}/references/architecture-rules.md` first, only when that stack directory exists.
6. **If implementation reveals the spec or design is wrong or unworkable**, do not silently
   edit the doc to match what got built. Follow the Design Change path below.
7. Rebase on main before the audit and re-run `docs_lint.py --check`

### Design Change path (R6)

This is the one thing the old workflow never defined: what to do when implementation shows
the spec or design was wrong. Silently rewriting the doc to match the code is exactly what
Step 5's audit baseline (the `origin/main` version of the doc, see the evaluator's audit
protocol) is built to catch, and an undocumented rewrite is a MAJOR finding there.

When the spec or design turns out to be wrong or unworkable:

1. Stop implementing that deliverable.
2. Update the document, on the same branch, to reflect what is now believed correct.
3. Append a **Design Change** entry recording: what the doc said, what was found, what it now
   says, and why. No timestamp field that requires inventing a date; the commit itself is the
   record.
   - If an exec plan exists for this change, the entry goes in the exec plan.
   - On the Core or Design tier (no exec plan), the entry goes in the PR description instead.
4. Reset the document's frontmatter status to `In Review`.
5. Resume implementation.

A Design Change entry is what distinguishes legitimate design evolution from post-hoc
alignment. The evaluator treats a doc modified on this branch as legitimate only if a
matching Design Change entry exists; otherwise it is a MAJOR finding, because the doc was
edited to make the audit pass rather than to record a real decision.

## Step 5: Post-Implementation Audit - MANDATORY

**Not optional, and not performed by the implementing agent.** Delegated to the `fleet-evaluator`
subagent: `.claude/agents/fleet-evaluator.md` when it exists in the repo, otherwise the
plugin-provided `fleet-engineering:fleet-evaluator`. See 5.2 for the exact selection rule.

**5.1 - Bookkeeping first**, scoped to the route the R2 signals selected:

Core (always):
1. Confirm the five R2 signal values declared in the PR description match what was actually built; fix the description if the change grew past its original route.
2. `python tools/docs_lint.py --fix && python tools/docs_lint.py --check` (skip in degraded mode)

Design tier (adds, when a design doc was required):
3. Update design doc for any interface or model change, with a Design Change entry for every divergence from what Step 2 originally said
4. Update or create `docs/quality/{area}.md` for every affected area

Full tier (adds, when spec + plan were required):
5. Mark deliverables and acceptance criteria `[x]` in the exec plan
6. Plan fully done? Status -> `Completed`, move to `docs/exec-plans/completed/`
7. Update product spec if behavior changed, with a Design Change entry for every divergence
8. Create `docs/tech-debt/TD-{TICKET}*.md` for shortcuts taken

**5.2 - Spawn the evaluator** (`subagent_type: "fleet-evaluator"`, or `"fleet-engineering:fleet-evaluator"` when it comes from the installed pack rather than the repo) with: change type, declared R2 signals, exec plan path (if any), design doc path (if any), spec path (if any), changed file list, round number, and previous findings + responses when round > 1.

**5.3 - Audit Protocol loop** (full spec in `SKILL.md`): Fix / Rebut-with-evidence / Defer-with-doc-update per finding; max 3 rounds; PASS requires zero BLOCKER/MAJOR; never self-declare PASS. The evaluator's baseline for every doc comparison is the `origin/main` version of the doc, not the working-tree copy; a doc changed on this branch without a matching Design Change entry is a MAJOR finding regardless of whether the code now matches it.

> **Why mandatory**: passing tests mean the code works; updated docs mean the next agent or
> teammate can understand it; the independent evaluator catches silent drift between the two.
> In a team the cost of drift is multiplied by every person who reads the stale doc.

## Definition of Done (R7, layered)

A change satisfies the tier its R2 routing selected, and no more. A bug fix routed to Core is
not held to the exec plan's deliverables; a Full-tier feature is.

**Core** (every change, no exceptions):
- Build passes with warnings-as-errors; all tests pass
- Formatting and architecture checks pass
- No secrets in code
- Evaluator verdict PASS, or a user-authorized skip logged as tech debt
- The five R2 signals declared in the PR description and matching the diff

**Design tier** (adds, when S1, S2, or S3 is true and both S4 and S5 are false):
- Design doc reflects what was built, with a Design Change entry for every divergence
- `docs/quality/{area}.md` updated for affected areas

**Full tier** (adds, when S4 or S5 is true):
- Product spec reflects actual behaviour
- Exec plan deliverables checked off; plan moved to `completed/` when fully done
- `docs_lint.py --check` passes
- Tech debt entries created for shortcuts

## Code PR

Before opening (Core, always):

- [ ] Evaluator verdict PASS (or user-authorized skip logged in tech debt)
- [ ] Build passes with warnings-as-errors; all tests pass; format passes
- [ ] PR description contains: ticket, the five R2 signal values, link to exec plan (if any), evaluator summary (rounds + deferred findings)
- [ ] PR contains both docs and code; doc commits precede the first implementation commit
- [ ] PR is a single logical unit (one phase = one PR is the default)
- [ ] No secrets in code

Add when the route required them: `docs_lint.py --check` passes (Design/Full tier); exec plan
deliverables checked off (Full tier).

CI enforces: format/build/test, architecture tests, docs lint, and the plan-reference gate.
The gate now fires on **diff content**, not on branch name (R3): if the diff touches any
non-test, non-doc source file, the gate requires either an exec plan for the ticket reachable
on the branch, or a `docs/tech-debt/TD-{TICKET}-docs-waiver.md` entry in the same PR, or (Core
tier) a well-formed R2 signals block in the PR description. Ticket resolution order: PR title
-> PR description -> branch name -> commit messages.

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
| New feature started | Spec + design + plan, committed on the same branch before implementation, status `In Review` |
| Architecture decision made | Design doc, same branch, same PR |
| Spec or design found wrong during implementation | Design Change path: update the doc, append a Design Change entry, reset status to `In Review` (see Step 4) |
| Phase completed | Check off deliverables; bump `updated` in frontmatter |
| Scope changed mid-implementation | Amend Claims section before touching new paths |
| Shortcut taken | New `docs/tech-debt/TD-*.md` entry |
| Tech debt resolved | Set `resolved` + `pr` in the entry's frontmatter |
| Audit done | Update `docs/quality/{area}.md`; dashboard regenerates |
| Feature shipped | Plan to `completed/`, status `Completed` |
| Anything above | `python tools/docs_lint.py --fix` before committing |
