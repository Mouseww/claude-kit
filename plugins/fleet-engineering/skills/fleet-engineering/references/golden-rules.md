# Golden Rules

> Core beliefs that every fleet engineering project encodes and mechanically enforces.
> These are the language-agnostic rules. For stack-specific rules, see `stacks/{stack}/references/golden-rules.md`.

## Universal Rules

These rules apply to any technology stack:

### Architecture Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | **Layer isolation is non-negotiable** — The innermost layer (Domain/Core) has zero external dependencies. Each layer depends only on layers further inward. | Architecture test suite |
| 2 | **Parse at boundaries, never trust raw input** — Validate at domain boundaries. Use strongly typed models internally. | Domain unit tests |
| 3 | **Prefer shared utilities over hand-rolled helpers** — Centralize logic so fixes propagate. | Code review / PR process |

### Agent Workflow Rules

| # | Rule | Enforcement |
|---|------|-------------|
| 4 | **The repo is the source of truth** — If it's not in the repo, it doesn't exist for agents. | AGENTS.md + team discipline |
| 5 | **Small, focused PRs** — One logical unit per PR. | Code review / PR process |
| 6 | **Mechanical enforcement over documentation** — If a rule can be a test or analyzer, make it one. | Meta-rule: audit during quality reviews |
| 7 | **Favor boring technology** — Choose stable, well-documented technologies with high composability. | Architecture decision records |
| 8 | **Automate drift cleanup** — Don't rely on manual cleanup. Encode checks, run them in CI. | CI pipeline + scheduled audits |

## Enforcement Hierarchy

When adding a new rule, choose the strongest enforcement mechanism available:

```
Strongest ──────────────────────────────────────── Weakest

  Build error      >    CI gate      >    PR review      >    Documentation
 (compiler,          (test suite,       (human/agent         (core-beliefs.md
  analyzer,           formatter,         checklist)            only)
  type system)        linter)
```

The goal is to push rules as far left as possible. A rule that only exists in documentation will eventually be forgotten.

## How to Add a New Rule

1. **Identify the rule** — What behavior do you want to enforce?
2. **Choose enforcement** — Can it be a build error? A CI gate? A test?
3. **Implement enforcement first** — Write the test/analyzer/config before the doc
4. **Document in core-beliefs.md** — Explain *why* the rule exists
5. **Add self-healing message** — If enforcement fails, include fix instructions

## Customizing for Your Project

Projects should:

- **Keep universal rules 1-8**: These are methodology principles that apply everywhere
- **Add stack-specific rules**: From `stacks/{stack}/references/golden-rules.md` — language-specific constraints with mechanical enforcement
- **Add project-specific rules**: Domain-specific constraints (e.g., "all monetary values use decimal, never float")
- **Remove only with justification**: Document why a rule was dropped in an ADR

Each project's `core-beliefs.md` should be a living document that evolves with the codebase.
