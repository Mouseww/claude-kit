---
type: design-doc
title: <!-- INSTRUCTION: Feature or system name -->
status: Draft
owner: <!-- INSTRUCTION: author id; the long-term owner per CODEOWNERS may differ from the author -->
ticket: <!-- INSTRUCTION: ticket ID -->
created: <!-- YYYY-MM-DD -->
updated: <!-- YYYY-MM-DD -->
relates:
  - <!-- INSTRUCTION: path to product spec, e.g., docs/product-specs/feature-name.md -->
---

# Design Document: <!-- INSTRUCTION: Feature or system name -->

> <!-- INSTRUCTION: One-sentence summary of what this design covers. -->

<!-- INSTRUCTION: Lifecycle: Draft -> In Review (docs PR) -> Approved -> Superseded/Archived.
     Changes to an Approved design doc go through a docs PR reviewed by the doc owner
     (CODEOWNERS routes this automatically). -->

## 1. Problem Statement

<!-- INSTRUCTION: What problem does this design solve? Why is the current state insufficient?
     2-3 paragraphs max; link to the product spec for full requirements. -->

## 2. Proposed Solution

### 2.1 System Overview

<!-- INSTRUCTION: High-level description. Include a flow diagram if helpful:

```
[Input] -> [Step 1] -> [Step 2] -> [Output]
```
-->

### 2.2 Domain Model

| Entity | Key Fields | Invariants |
|--------|-----------|------------|
| <!-- entity --> | <!-- fields --> | <!-- business rules it enforces --> |

### 2.3 Processing Pipeline

| Stage | Input | Output | Error Handling |
|-------|-------|--------|---------------|
| <!-- stage --> | <!-- in --> | <!-- out --> | <!-- on failure --> |

## 3. Layer Responsibilities

<!-- INSTRUCTION: Map the design to the project's architecture layers. Adjust names to match. -->

### 3.1 Core / Domain Layer
<!-- Entities, value objects, enumerations, domain services, invariants. Zero external deps. -->

### 3.2 Application / Service Layer
<!-- Use cases, interfaces (repositories, external services), orchestration. Depends only on Domain. -->

### 3.3 Infrastructure / Adapter Layer
<!-- Implementations of Application interfaces, SDK integrations, persistence, API clients. -->

### 3.4 API / Presentation Layer
<!-- Entry points, request/response DTOs, DI registration, middleware. -->

## 4. Data Flow Example

<!-- INSTRUCTION: Walk one concrete scenario end-to-end through all layers.
     The most valuable section for implementing agents. -->

```
1. Entry point receives request
2. Controller/handler maps request DTO -> Application command
3. Use case validates input, calls domain logic
4. Domain entity enforces invariants, produces result
5. Infrastructure persists result / calls external service
6. Entry point returns response
```

## 5. Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| <!-- name --> | <!-- default --> | <!-- what it controls --> |

## 6. Alternatives Considered

<!-- INSTRUCTION: Prevents future re-debate of settled decisions. -->

| Alternative | Pros | Cons | Why Rejected |
|------------|------|------|-------------|
| <!-- approach --> | <!-- benefits --> | <!-- drawbacks --> | <!-- rationale --> |

## 7. Open Questions

<!-- INSTRUCTION: Unresolved decisions. Remove this section once all are answered;
     a design doc cannot move to Approved with open BLOCKING questions. -->

- [ ] <!-- question needing resolution -->
