# Feedback Controls (Sensors)

> Controls that observe **after** the agent acts and enable self-correction.

## What Are Feedback Controls?

Feedback controls detect problems in agent-generated output and provide corrective signals. They are the "guardrail" half of the harness — catching mistakes and guiding agents back on track.

The key insight: feedback controls are most powerful when they are **optimized for LLM consumption**, not just human readability. A stack trace is useful; a stack trace with "How to fix" instructions is a self-healing mechanism.

## Two Categories of Feedback Controls

### Computational Controls (Deterministic)

Fast, reliable, binary checks that run in milliseconds to seconds:

| Control | What It Catches | Speed |
|---------|----------------|-------|
| **Compiler/type checker** | Type errors, missing imports, syntax | Seconds |
| **Linter/formatter** | Style violations, naming conventions | Seconds |
| **Static analyzer** | Potential bugs, complexity, security | Seconds |
| **Architecture tests** | Layer dependency violations | Seconds |
| **Unit tests** | Logic bugs in isolated components | Seconds |
| **Integration tests** | Cross-component interaction bugs | Minutes |

### Inferential Controls (Semantic)

Slower checks that involve AI judgment or semantic analysis:

| Control | What It Catches | Speed |
|---------|----------------|-------|
| **Agent-to-agent code review** | Design issues, missed edge cases | Minutes |
| **Semantic diff analysis** | Unintended behavioral changes | Minutes |
| **Documentation consistency check** | Docs drifting from implementation | Minutes |

## The Self-Healing Error Message Pattern

Every feedback control should include fix instructions that an agent can act on immediately:

```
========================================
[WHAT FAILED] — clear, specific title
========================================

[WHY this rule exists — 2-3 lines]

How to fix:
  1. [Specific action with exact command or file path]
  2. [Specific action]
  3. [Specific action]

Reference: [document to consult for full context]
========================================
```

**Bad**: `Test failed: LayerDependencyTests.DomainShouldNotDependOnApplication`
**Good**: `ARCHITECTURE VIOLATION — Domain must not reference Application. Move the dependent code to the Application layer. See ARCHITECTURE.md#dependency-rules`

## Enforcement Hierarchy

When adding a new rule, choose the strongest enforcement mechanism available:

```
Strongest ──────────────────────────────────────── Weakest

  Build error      >    CI gate      >    PR review      >    Documentation
 (compiler,          (test suite,       (human/agent         (core-beliefs.md
  analyzer,           formatter,         checklist)            only)
  type system)        linter)
```

The goal is to push rules **as far left as possible**. A rule that only exists in documentation will eventually be forgotten. A rule enforced by the compiler is impossible to violate.

## Designing Effective Feedback Controls

1. **Optimize for agent consumption** — Include structured error messages, not just error codes. Agents can self-correct if told how.
2. **Fail fast** — Run cheaper/faster controls first (format check before build, build before integration tests).
3. **Make failures specific** — "Build failed" is useless. "CA1852: Type 'OrderService' can be sealed — add `sealed` modifier" is actionable.
4. **Keep the feedback loop tight** — Agents should be able to run all feedback controls locally before pushing. Don't rely solely on CI.
5. **Layer your controls** — Computational controls catch 90% of issues instantly. Reserve inferential controls for what computation can't detect.

## The Steering Loop

When a feedback control fires repeatedly for the same class of mistake, this signals a gap in feedforward controls:

1. **Detect pattern** — The same architecture test fails across multiple PRs
2. **Diagnose root cause** — Agents don't understand the rule, or the project structure makes violation easy
3. **Improve feedforward** — Add explicit guidance to AGENTS.md, improve directory structure, or add type-level constraints
4. **Verify** — The feedback control should fire less frequently after the feedforward improvement

This continuous improvement loop is how fleet engineering projects get better over time.
