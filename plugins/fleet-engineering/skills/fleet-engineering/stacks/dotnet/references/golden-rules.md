# Golden Rules

> Core beliefs that every fleet engineering project encodes and mechanically enforces.

## The 10 Rules

These rules are the starting point for any fleet engineering project. They are captured in `docs/design-docs/core-beliefs.md` and each one is backed by a mechanical enforcement mechanism.

### Architecture Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | **Layer isolation is non-negotiable** — Domain has zero external deps. Application depends only on Domain. Infrastructure implements interfaces. | ArchUnitNET tests |
| 2 | **Parse at boundaries, never trust raw input** — Validate at domain boundaries. Use strongly typed models internally. | Domain unit tests |
| 3 | **Prefer shared utilities over hand-rolled helpers** — Centralize logic so fixes propagate. | Code review / PR process |

### Code Quality Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 4 | **Structured logging only** — Message templates, never interpolation. | Code review (can add custom analyzer) |
| 5 | **Seal what you can** — Internal types with no subtypes must be sealed. | CA1852 + TreatWarningsAsErrors |
| 6 | **File-scoped namespaces** — All C# files use file-scoped namespaces. | .editorconfig (warning level) |
| 7 | **Async all the way** — Async suffix mandatory. Never `.Result` or `.Wait()`. | .editorconfig (warning level) |

### Agent Workflow Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 8 | **The repo is the source of truth** — If it's not in the repo, it doesn't exist for agents. | AGENTS.md + team discipline |
| 9 | **Small, focused PRs** — One logical unit per PR. | Code review / PR process |
| 10 | **Mechanical enforcement over documentation** — If a rule can be a test or analyzer, make it one. | Meta-rule: audit during quality reviews |

## Enforcement Hierarchy

When adding a new rule, choose the strongest enforcement mechanism available:

```
Strongest ──────────────────────────────── Weakest

  Build error    >    CI gate    >    PR review    >    Documentation
 (analyzer,        (dotnet test,    (human/agent      (core-beliefs.md
  .csproj)          dotnet format)   checklist)         only)
```

The goal is to push rules as far left as possible. A rule that only exists in documentation will eventually be forgotten.

## How to Add a New Rule

1. **Identify the rule** — What behavior do you want to enforce?
2. **Choose enforcement** — Can it be a build error? A CI gate? A test?
3. **Implement enforcement first** — Write the test/analyzer/config before the doc
4. **Document in core-beliefs.md** — Explain *why* the rule exists
5. **Add self-healing message** — If enforcement fails, include fix instructions

## Customizing for Your Project

The 10 rules above are a starting point. Projects should:

- **Keep rules 1-7**: These are universal for .NET fleet engineering
- **Keep rules 8-10**: These are methodology principles
- **Add project-specific rules**: Domain-specific constraints (e.g., "all monetary values use decimal, never double")
- **Remove only with justification**: Document why a rule was dropped

Each project's `core-beliefs.md` should be a living document that evolves with the codebase.
