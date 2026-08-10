---
type: product-spec
title: <!-- INSTRUCTION: Feature name -->
status: Draft
owner: <!-- INSTRUCTION: author id -->
ticket: <!-- INSTRUCTION: ticket ID, e.g., PIEX-5336 -->
created: <!-- YYYY-MM-DD -->
updated: <!-- YYYY-MM-DD -->
relates: []
---

# Product Specification: <!-- INSTRUCTION: Feature name -->

> <!-- INSTRUCTION: One-sentence summary of what this feature does and who it serves. -->

<!-- INSTRUCTION: Lifecycle: Draft -> In Review (committed to the implementation branch,
     complete) -> Approved (set by the human PR reviewer or by merge automation, never by
     the agent). Implementation must not start against a Draft spec. `In Review` is the
     normal working state during implementation, since docs and code ship in one PR. -->

## Glossary

<!-- INSTRUCTION: Define all domain terms used in this spec. Critical for agent comprehension. -->

| Term | Definition |
|------|-----------|
| <!-- term --> | <!-- definition --> |

## User Workflow

<!-- INSTRUCTION: Describe the end-to-end user journey in phases. Each phase should map
     to one or more functional requirements below. -->

### Phase 1: <!-- e.g., Upload, Configure, Submit -->

### Phase 2: <!-- e.g., Processing, Execution -->

### Phase 3: <!-- e.g., Review, Results, Output -->

## Functional Requirements

<!-- INSTRUCTION: Group related requirements under numbered headers (F1, F2, ...).
     Each sub-requirement independently testable. -->

### F1 - <!-- Requirement group name -->

| ID | Requirement |
|----|------------|
| F1.1 | <!-- specific, testable requirement --> |
| F1.2 | <!-- specific, testable requirement --> |

### F2 - <!-- Requirement group name -->

| ID | Requirement |
|----|------------|
| F2.1 | <!-- specific, testable requirement --> |

## Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|------------|
| NF1 | <!-- e.g., Performance --> | <!-- measurable requirement --> |
| NF2 | <!-- e.g., Reliability --> | <!-- measurable requirement --> |
| NF3 | <!-- e.g., Security --> | <!-- measurable requirement --> |

## API Summary

<!-- INSTRUCTION: List all API endpoints this feature requires. Remove if no API surface. -->

| Method | Endpoint | Description |
|--------|----------|-------------|
| <!-- POST/GET --> | <!-- /api/v1/... --> | <!-- what it does --> |

## Acceptance Criteria

<!-- INSTRUCTION: The definition of done for the feature. Each criterion independently
     verifiable, "When [action], then [expected outcome]" format. Agents validate their
     implementation against these; the fleet-evaluator audits against them. Aim for 5-10. -->

| ID | Criterion |
|----|----------|
| AC1 | <!-- When X, then Y --> |
| AC2 | <!-- When X, then Y --> |
| AC3 | <!-- When X, then Y --> |
