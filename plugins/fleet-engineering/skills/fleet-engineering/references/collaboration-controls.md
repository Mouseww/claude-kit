# Collaboration Controls

> How multiple humans and their agents work in the same repo without corrupting each other's work.
> This is the Layer 2 reference: same-branch doc ordering, claims, ownership, and approval gates.

## The Problem

Git merges text, not meaning. Two feature branches can both edit the same design doc, merge cleanly, and produce a document that contradicts itself. Two developers can both start "the next" exec plan and pick the same number. Two agents can refactor the same module in parallel and waste one of the two efforts entirely.

A solo harness never hits these problems because there is one writer. A team hits all of them weekly. The controls below make coordination mechanical instead of social.

## Control 1: One branch, one PR, docs still first

**`main` is branch-protected. Nothing lands there without a PR, not code, not docs, not
claims.** A separate docs-only PR does not avoid that: it still needs review and approval like
any other PR, so it buys a full PR cycle and a human-gated blocker in the middle of the work,
in exchange for making coordination information visible slightly earlier. That trade is not
worth it. Instead, docs and code ship in the **same PR**, and coordination information is
read from remote branches and open PRs, not from main (Control 2, R4).

**Rule: specs, design docs, and exec plans are authored and committed BEFORE the first
implementation commit, on the SAME branch that will carry the implementation.**

```
feature branch (feature/{TICKET}-{slug})
    Spec + Design + Plan committed first, status: In Review
        |
    implementation, phase by phase, same branch
        |
    evaluator PASS -> ONE PR (docs + code) -> human review -> merge
        |
    on approval / merge: status -> Approved (spec/design) / Active or Completed (plan)
```

Why this ordering matters, even without a separate PR:

1. **Review timing**: a spec written and committed before coding gives the reviewer something
   coherent to read first, in commit order; a spec that only exists retrofitted into a
   3,000-line diff gets rubber-stamped.
2. **The lock**: your own exec plan's Claims section exists as soon as it is committed and
   pushed, so Step 0 conflict detection on someone else's branch or PR can see it (Control 2).
3. **Order is verifiable**: the evaluator checks `git log --format=%H%x09%s --name-only
   origin/main...HEAD` and reports a MAJOR finding if the first implementation commit precedes
   the doc commits, for any change that required a design doc or plan.

Document status lifecycle on the branch: `Draft` (being written, implementation MUST NOT
start) -> `In Review` (doc is complete and committed; implementation may proceed) ->
`Approved` / `Active` (set by the human PR reviewer on approval, or by merge automation, never
by the agent).

CODEOWNERS still routes doc owners onto the PR automatically; since there is no separate docs
PR, this is now the only mechanism by which a doc owner sees the change before merge.

**Waiver**: for genuinely urgent fixes the user may skip the plan-reference gate entirely. Log
the waiver as a tech debt entry (`docs/tech-debt/TD-{TICKET}-docs-waiver.md`) so the skipped
review is visible and recoverable.

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

1. **Pre-flight (Step 0, before any doc is written)**: `git fetch --all --prune`, then
   enumerate `origin/*` branches and, where a PR host CLI is available, open PRs. Read
   `docs/exec-plans/active/*.md` present on each. Compare your intended scope against every
   discovered plan's claims. No plan is discoverable anywhere (fresh project, no remote
   history)? Report conflict detection as "not available" and continue.
2. **Two-stage comparison, cheap first**: reduce every claim's `code` glob (and your own
   intended scope) to its first two path segments and compare at that granularity first
   (coarse). Only on a coarse hit, run the full glob overlap comparison (fine). This keeps the
   check cheap across every remote branch instead of doing a full glob diff against everything.
3. **Overlap found**: STOP. Surface the overlap to the humans involved. Outcomes: re-scope one plan, sequence the work (B waits for A), or explicitly accept the conflict risk (record the decision in both plans). Agents never arbitrate this; people do.
4. **Stay inside your claims**: during implementation, if you need to touch a path outside your claims, amend the Claims section first in a small commit on your own branch. The lock must always reflect reality.
5. **Claims are soft locks**: they warn, they do not physically block. The point is that conflicts get discovered before a doc or a line of code is written, not at merge time in a 40-file PR.
6. **Release the lock**: when the plan moves to `completed/` and merges, its claims stop participating in overlap checks.

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
| Draft | Being written, not committed to the branch yet, or not yet complete | Implementation MUST NOT start |
| In Review | Complete, committed to the same branch that will carry the implementation; PR not yet approved | Implementation may proceed; this is the working state during the implementation phase |
| Approved (spec/design) / Active (plan) | PR approved by the human reviewer, or set by merge automation | Change may merge |
| Completed (plan) | All phases done, audit passed, merged | Claims released |
| Superseded / Archived | Replaced or obsolete | Agents must not follow it; must link successor |

The fleet-evaluator verifies during audit that the implemented work traces to a spec and plan
that are at least `In Review`, and checks commit order (doc commits before the first
implementation commit) rather than requiring the docs to already be `Approved` on main, since
they merge together. Implementing against a `Draft` is a MAJOR finding.

## Control 5: Roles and approval chain

| Role | Who | Responsibility |
|------|-----|---------------|
| Implementer | Developer + their agent | Author docs and code, run bookkeeping, never self-audit |
| Doc owner | Human per CODEOWNERS | Review the doc portion of the PR, arbitrate claim overlaps, guard semantic consistency |
| Evaluator | `fleet-evaluator` subagent (in repo) | Adversarial audit; PASS is the precondition for opening the PR |
| PR reviewer | Human teammate | Final approval of the single PR (docs + code); evaluator PASS does not replace this |

The chain for a feature: implementer commits docs then code on one branch -> evaluator passes -> doc owner and PR reviewer approve the single PR -> merge. One human gate covering both docs and code, one adversarial agent gate, all mechanical to skip-detect.

## Control 6: Rebase discipline

- Rebase (or merge main into) your feature branch before running the Step 5 audit. The evaluator must see your work against current main, including anything that merged while you worked.
- After rebasing, re-run `tools/docs_lint.py --check`: a plan that merged to main mid-flight may now overlap your claims, and a design doc you updated may have moved under you.
- Doc merge conflicts are resolved by the implementer textually, then confirmed by the doc owner semantically (the CODEOWNERS review on the single PR covers this).

## Anti-Patterns

1. **Docs committed after the code they describe** - defeats the ordering check the evaluator runs (`git log` commit order); a doc that only shows up once the code is done is post-hoc, not planned.
2. **Mega-claims** - claiming `src/**` to be safe blocks everyone and tells nobody anything.
3. **Stale Active plans** - an abandoned plan holds locks forever. The docs linter flags plans not updated in N days (default 21); triage them in the drift cleanup cadence.
4. **Approval by silence** - "no one objected to my PR in 2 hours so I merged" defeats the gate. Required-reviewer settings on the platform make this mechanical.
5. **Editing another plan's claims** to unblock yourself. Claims changes belong to the plan's owner; negotiate, don't edit.
6. **Rewriting a doc to match the code with no Design Change entry** - this is post-hoc alignment, not design evolution, and is a MAJOR finding under the evaluator's audit baseline (see `development-workflow.md`, Design Change path).
