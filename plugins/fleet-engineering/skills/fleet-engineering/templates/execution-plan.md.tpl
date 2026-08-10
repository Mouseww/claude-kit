---
type: exec-plan
title: <!-- INSTRUCTION: Plan title, e.g., "MVP: Feature Name" -->
status: Draft
owner: <!-- INSTRUCTION: author id, e.g., axel_feng -->
ticket: <!-- INSTRUCTION: ticket ID, e.g., PIEX-5336. File name must be {TICKET}-{slug}.md -->
created: <!-- YYYY-MM-DD -->
updated: <!-- YYYY-MM-DD; bump on every meaningful edit -->
relates:
  - <!-- INSTRUCTION: path to product spec -->
  - <!-- INSTRUCTION: path to design doc -->
claims:
  code:
    - <!-- INSTRUCTION: glob of code paths this plan will touch, e.g., "src/{{ProjectName}}.Application/Orders/**" -->
    - <!-- INSTRUCTION: claim directories/globs, not single files and not whole layers. "src/**" is a smell: split the plan. -->
  docs:
    - <!-- INSTRUCTION: docs this plan will modify, e.g., "docs/design-docs/orders.md" -->
---

# Execution Plan: <!-- INSTRUCTION: same title as frontmatter -->

> <!-- INSTRUCTION: One-sentence goal of this execution plan. -->

<!-- INSTRUCTION: Lifecycle reminder.
     Draft (being written, implementation MUST NOT start)
     -> In Review (committed to this branch, complete; implementation may proceed, this is the
        working state during implementation)
     -> Active (PR approved by the human reviewer, or set by merge automation; claims are now
        live locks; not something the agent sets on itself)
     -> Completed (all phases done + audit passed; move file to docs/exec-plans/completed/).
     Docs and code ship in the same PR; there is no separate docs-only PR to main.
     Before authoring: run `python tools/docs_lint.py --check` and resolve any claim overlap
     against plans discovered on remote branches and open PRs, not main
     (see references/collaboration-controls.md). -->

## Overview

<!-- INSTRUCTION: Brief summary of the implementation approach. What are we building
     and in what order? 2-3 paragraphs max. -->

## Relevant Skills

<!-- INSTRUCTION: List the domain/project skills the implementer should load per phase,
     so skill usage is feedforward (declared here) instead of relying on the agent
     remembering to trigger them mid-implementation. Check the repo's AGENTS.md
     "Module Skills Map" and .claude/skills/ for candidates. Delete if none apply.
     Precedence reminder: fleet-engineering governs workflow and gates; the skills
     below govern HOW the code/artifact is written. -->

| Phase | Skill | Why |
|-------|-------|-----|
| <!-- e.g., Phase 3 --> | <!-- e.g., rawdata-repair --> | <!-- e.g., repair handlers must follow the registered chain pattern --> |

## Phase Dependency Map

<!-- INSTRUCTION: Show which phases depend on which, so agents and teammates can see
     what can be parallelized. -->

```
Phase 1 (Domain Model)
    |
Phase 2 (Application Interfaces)
    |
    +-- Phase 3 (Persistence)        <- can start after Phase 2
    +-- Phase 4 (External Services)  <- can start after Phase 2
         |
Phase 5 (API Endpoints)             <- needs Phase 2-4
    |
Phase 6 (E2E Integration & Tuning)  <- needs Phase 5
```

---

## Phase 1: <!-- INSTRUCTION: Phase name -->

<!-- INSTRUCTION: What does this phase accomplish? One sentence.
     Remember: each phase is its own development request with its own Step E audit. -->

**Dependencies**: None
**Estimated effort**: <!-- Small / Medium / Large -->

### Deliverables

<!-- INSTRUCTION: Every concrete artifact this phase produces, independently verifiable. -->

- [ ] <!-- deliverable 1 -->
- [ ] <!-- deliverable 2 -->

### Acceptance Criteria

- [ ] Build passes with warnings-as-errors
- [ ] All tests pass (including architecture tests)
- [ ] `python tools/docs_lint.py --check` passes
- [ ] <!-- INSTRUCTION: Phase-specific verification -->

---

## Phase 2: <!-- INSTRUCTION: Phase name -->

**Dependencies**: Phase 1
**Estimated effort**: <!-- Small / Medium / Large -->

### Deliverables

- [ ] <!-- deliverable 1 -->

### Acceptance Criteria

- [ ] Build passes with warnings-as-errors
- [ ] All tests pass
- [ ] <!-- INSTRUCTION: Phase-specific verification -->

---

<!-- INSTRUCTION: Continue with Phase 3, 4, ... Typical MVP: domain model, application
     interfaces, persistence, external integrations, background processing, API endpoints,
     E2E integration. -->

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| <!-- what could go wrong --> | Low / Medium / High | Low / Medium / High | <!-- how to reduce or handle --> |

## External Dependencies

| Dependency | Owner | Status | Notes |
|-----------|-------|--------|-------|
| <!-- e.g., API access, SDK availability --> | <!-- who controls it --> | Pending / Available | <!-- context --> |

## Decisions Log

<!-- INSTRUCTION: Append-only. Record scope changes, claim amendments, deferred audit
     findings, and waivers here with dates, so the history survives in one place.
     Example: "2026-06-12: extended claims to src/X/** because ...; approved by owner-of-X" -->
