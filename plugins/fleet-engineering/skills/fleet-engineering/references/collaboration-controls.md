# Collaboration Controls

> How multiple humans and their agents work in the same repo without corrupting each other's work.
> This is the Layer 2 reference: docs-first PRs, claims, ownership, and approval gates.

## The Problem

Git merges text, not meaning. Two feature branches can both edit the same design doc, merge cleanly, and produce a document that contradicts itself. Two developers can both start "the next" exec plan and pick the same number. Two agents can refactor the same module in parallel and waste one of the two efforts entirely.

A solo harness never hits these problems because there is one writer. A team hits all of them weekly. The controls below make coordination mechanical instead of social.

## Control 1: Docs-first PR

**Rule: specs, design docs, and exec plans merge to main BEFORE implementation starts.**

```
docs branch (docs/{TICKET}-{slug})
    Spec + Design + Plan, status: In Review
        |
    docs-only PR  ->  reviewed by doc owners + overlapping-claim holders
        |
    merged to main, status: Approved / Active   <- now visible to the whole team
        |
feature branch (feature/{TICKET}-{slug})
    implementation, phase by phase
        |
    evaluator PASS -> code PR -> human review -> merge
```

Why this ordering matters:

1. **Visibility**: "Repo is source of truth" fails when truth sits on a feature branch nobody fetched. Only main is shared truth. A plan on main is a public declaration of intent.
2. **Review timing**: a spec reviewed before coding costs minutes; a spec reviewed inside a 3,000-line implementation PR gets rubber-stamped.
3. **The lock**: once the plan is on main, its Claims section participates in everyone's pre-flight check.

A docs-first PR should be small and fast to review. If reviewers take days, the team has an ownership problem (fix CODEOWNERS assignments), not a process problem.

**Waiver**: for genuinely urgent fixes the user may skip the docs PR. Log the waiver as a tech debt entry (`docs/tech-debt/TD-{TICKET}-docs-waiver.md`) so the skipped review is visible and recoverable.

## Control 2: Claims

Every exec plan declares what it will touch, in machine-readable frontmatter:

```yaml
claims:
  code:
    - "src/{{ProjectName}}.Application/Orders/**"
    - "src/{{ProjectName}}.Infrastructure/Archive/**"
  docs:
    - "docs/design-docs/order-archive.md"
```

Rules:

1. **Pre-flight**: before starting any development request, compare your intended scope against the claims of every plan in `docs/exec-plans/active/` on main. `tools/docs_lint.py --check` reports overlaps between active plans automatically.
2. **Overlap found**: STOP. Surface the overlap to the humans involved. Outcomes: re-scope one plan, sequence the work (B waits for A), or explicitly accept the conflict risk (record the decision in both plans). Agents never arbitrate this; people do.
3. **Stay inside your claims**: during implementation, if you need to touch a path outside your claims, amend the Claims section first in a small docs commit. The lock must always reflect reality.
4. **Claims are soft locks**: they warn, they do not physically block. The point is that conflicts get discovered at planning time on main, not at merge time in a 40-file PR.
5. **Release the lock**: when the plan moves to `completed/`, its claims stop participating in overlap checks.

Granularity guidance: claim directories or glob patterns, not individual files (too brittle) and not whole layers (too coarse). A claim that says `src/**` is a smell; split the plan.

## Control 3: Ownership (CODEOWNERS)

Git resolves textual conflicts; owners resolve semantic conflicts.

- Map `docs/design-docs/{domain}` and the corresponding code directories to the same owner(s) in CODEOWNERS (see `templates/CODEOWNERS.tpl`).
- Any PR touching an owned doc automatically requires that owner's review. This guarantees one human brain sits at the merge point of every design document and can spot "both halves merged cleanly but the doc now contradicts itself."
- Owners are also the arbiters for claim overlaps in their domain.
- Keep ownership current: an owner who left the team is a broken gate. Review CODEOWNERS quarterly (fold into the drift cleanup cadence).

## Control 4: Status gates

Document statuses are gates, not labels:

| Status | Meaning | Gate |
|--------|---------|------|
| Draft | Being written, not agreed | Implementation MUST NOT start |
| In Review | Docs PR open | Implementation MUST NOT start |
| Approved (spec/design) / Active (plan) | Merged to main, agreed | Implementation may start |
| Completed (plan) | All phases done, audit passed | Claims released |
| Superseded / Archived | Replaced or obsolete | Agents must not follow it; must link successor |

The fleet-evaluator verifies during audit that the implemented work traces to an `Approved` spec and an `Active`/`Completed` plan. Implementing against a Draft is a MAJOR finding.

## Control 5: Roles and approval chain

| Role | Who | Responsibility |
|------|-----|---------------|
| Implementer | Developer + their agent | Author docs and code, run bookkeeping, never self-audit |
| Doc owner | Human per CODEOWNERS | Approve docs-first PRs, arbitrate claim overlaps, guard semantic consistency |
| Evaluator | `fleet-evaluator` subagent (in repo) | Adversarial audit; PASS is the precondition for opening a code PR |
| PR reviewer | Human teammate | Final approval of the code PR; evaluator PASS does not replace this |

The chain for a feature: doc owner approves the plan -> implementer builds -> evaluator passes -> PR reviewer merges. Two human gates, one adversarial agent gate, all mechanical to skip-detect.

## Control 6: Rebase discipline

- Rebase (or merge main into) your feature branch before running the Step E audit. The evaluator must see your work against current main, including docs that merged while you worked.
- After rebasing, re-run `tools/docs_lint.py --check`: a plan that merged to main mid-flight may now overlap your claims, and a design doc you updated may have moved under you.
- Doc merge conflicts are resolved by the implementer textually, then confirmed by the doc owner semantically (the CODEOWNERS review on the PR covers this).

## Anti-Patterns

1. **Plan on the feature branch** - the team cannot see your lock; you have no lock.
2. **Mega-claims** - claiming `src/**` to be safe blocks everyone and tells nobody anything.
3. **Stale Active plans** - an abandoned plan holds locks forever. The docs linter flags plans not updated in N days (default 21); triage them in the drift cleanup cadence.
4. **Approval by silence** - "no one objected to my docs PR in 2 hours so I merged" defeats the gate. Required-reviewer settings on the platform make this mechanical.
5. **Editing another plan's claims** to unblock yourself. Claims changes belong to the plan's owner; negotiate, don't edit.
