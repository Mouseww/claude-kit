---
type: quality-area
title: <!-- INSTRUCTION: Area name, e.g., "Application / Services" -->
status: Active
owner: <!-- INSTRUCTION: area owner, should match CODEOWNERS -->
ticket: <!-- INSTRUCTION: ticket of the audit that produced this score, or n/a -->
created: <!-- YYYY-MM-DD -->
updated: <!-- YYYY-MM-DD -->
area: <!-- INSTRUCTION: stable area key, used as file name: docs/quality/{area}.md, e.g., application -->
score: <!-- A / B / C / D / F -->
reviewed: <!-- YYYY-MM-DD of last review -->
---

# Quality: <!-- INSTRUCTION: Area name -->

<!-- INSTRUCTION: One file per architecture area / concern. docs/QUALITY_SCORE.md is
     GENERATED from these files by tools/docs_lint.py; never edit the dashboard by hand.
     Update this file in Step E whenever your change touches this area.

     Scoring criteria:
     - A: well-tested, documented, follows all golden rules
     - B: mostly complete, minor gaps in tests or docs
     - C: functional but needs cleanup or missing tests
     - D: significant debt, needs immediate attention
     - F: broken or non-functional

     Prefer evidence over vibes: cite coverage numbers, warning counts, architecture
     test status. Two teammates should arrive at the same letter from the same evidence. -->

## Current Assessment

<!-- INSTRUCTION: 2-5 bullet justification of the score, with evidence. -->

- <!-- e.g., line coverage 84% (dotnet test /p:CollectCoverage) -->
- <!-- e.g., 0 analyzer suppressions; architecture tests green -->

## Known Gaps

<!-- INSTRUCTION: What keeps this area from the next letter up. Link tech debt entries: docs/tech-debt/TD-*.md -->

## History

<!-- INSTRUCTION: Append-only log of score changes: "YYYY-MM-DD: B -> A, after PIEX-1234 added integration tests" -->
