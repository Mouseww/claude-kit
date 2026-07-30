---
type: tech-debt
title: <!-- INSTRUCTION: Brief debt description -->
status: Active
owner: <!-- INSTRUCTION: who incurred / owns the debt -->
ticket: <!-- INSTRUCTION: originating ticket, e.g., PIEX-5336. File name: docs/tech-debt/TD-{TICKET}.md, suffix -a/-b if several per ticket -->
created: <!-- YYYY-MM-DD -->
updated: <!-- YYYY-MM-DD -->
priority: <!-- P1 (blocks future work) / P2 (causes friction) / P3 (cosmetic) -->
area: <!-- Domain / Application / Infrastructure / Api / Tests / Docs / Process -->
resolved: <!-- leave empty while active; set YYYY-MM-DD when fixed -->
pr: <!-- link to the resolving PR when fixed -->
---

# TD-<!-- TICKET -->: <!-- INSTRUCTION: same title as frontmatter -->

<!-- INSTRUCTION: One file per debt entry. NEVER append entries to a shared tracker file;
     the index at docs/tech-debt/index.md is GENERATED from these files.
     Do not delete resolved entries: set `resolved` + `pr` in frontmatter and status -> Archived.
     They are the historical record of decisions. -->

## What

<!-- INSTRUCTION: What the debt is, concretely. Which files/components carry it. -->

## Why It Was Incurred

<!-- INSTRUCTION: The trade-off that justified it, e.g., "in-memory queue instead of
     message bus: MVP scope constraint", "shipped without evaluator audit:
     user-authorized skip on YYYY-MM-DD". -->

## Impact If Unpaid

<!-- INSTRUCTION: What gets harder or riskier over time. P1 entries older than 30 days
     are flagged by the docs linter. -->

## Suggested Resolution

<!-- INSTRUCTION: Concrete path to paying it off, with rough effort. -->
