# Automated Drift Cleanup

> Don't rely on manual cleanup. Encode golden principles into automated checks and run recurring cleanup processes.

## The Problem

In agent-first development, agents produce code at a much higher rate than human engineers. This amplifies an existing problem: **codebase drift** — the gradual divergence between how the codebase should look and how it actually looks.

Common drift categories:
- **Style drift** — Formatting, naming conventions, import ordering
- **Architecture drift** — Layer violations, forbidden dependencies, misplaced logic
- **Documentation drift** — Docs that no longer match the implementation
- **Dependency drift** — Unused dependencies, outdated versions, inconsistent versions
- **Pattern drift** — Inconsistent approaches to the same problem across the codebase

OpenAI's team initially spent 20% of their time (every Friday) manually cleaning up "AI slop." This didn't scale. The solution: encode golden principles directly into the repository and automate the cleanup.

## The Three-Layer Defense

### Layer 1: Prevention (Feedforward)

Stop drift before it happens:

- **AGENTS.md** with explicit constraints
- **Strong typing** and strict compiler settings
- **Templates** for common patterns
- **Variety reduction** — commit to one way of doing things

### Layer 2: Detection (Feedback)

Catch drift immediately when it occurs:

- **Format checks** in CI — catch style drift
- **Architecture tests** — catch layer violations
- **Build with warnings-as-errors** — catch code quality drift
- **Linter rules** — catch pattern drift
- **Documentation linter** — catch broken links, outdated references

### Layer 3: Automated Cleanup (Garbage Collection)

Periodically repair drift that slipped through:

- **Scheduled cleanup tasks** — Run formatting, import sorting, unused code removal on a schedule
- **Dependency audits** — Automated checks for outdated or unused dependencies
- **Documentation sync** — Automated comparison of docs vs. implementation
- **Tech debt sweeps** — Periodic review of `docs/tech-debt/` entries (one file per item; index is generated)

## Implementing Automated Drift Cleanup

### Step 1: Define Golden Principles

Encode your project's non-negotiable standards in `docs/design-docs/core-beliefs.md`. Each principle must have a mechanical enforcement mechanism.

### Step 2: Build Automated Checks

For each golden principle, create an automated check:

| Principle | Automated Check |
|-----------|----------------|
| Consistent formatting | Format command with `--verify-no-changes` flag |
| No architecture violations | Architecture test suite |
| No unused dependencies | Package audit command |
| All public APIs documented | Documentation coverage tool |
| No TODO/FIXME older than N days | Custom script or linter rule |
| Consistent error handling | Custom linter or architecture test |

### Step 3: Run Checks in CI

Every check runs on every PR. Failures block merge. Error messages include self-healing instructions.

### Step 4: Schedule Periodic Deep Cleans

Some cleanup is too expensive for every PR but should run regularly:

| Frequency | Cleanup Task |
|-----------|-------------|
| **Every PR** | Format, build, test, architecture checks |
| **Weekly** | Dependency audit, documentation link check |
| **Monthly** | Full quality score audit, tech debt review |
| **Quarterly** | Architecture fitness review, golden rules review |

### Step 5: Track Drift Metrics

Use the quality score dashboard (`docs/QUALITY_SCORE.md`) to track drift over time:
- Score trending downward? Add more automated checks.
- Same area repeatedly scoring low? Investigate root cause and add feedforward controls.

## Anti-Patterns

1. **Manual-only cleanup** — If cleanup requires human initiative, it won't happen consistently
2. **Cleanup sprints** — Dedicating entire sprints to cleanup means you're not preventing drift
3. **Ignoring warnings** — Suppressing warnings without fixing root causes is drift acceleration
4. **Format-on-save only** — Relying on individual editor settings is fragile; enforce in CI
5. **Audit without action** — Quality scores that nobody acts on are theater, not engineering
