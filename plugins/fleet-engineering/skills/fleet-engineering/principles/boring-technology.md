# Favor Boring Technology

> Stable, well-documented technologies with high composability are easier for agents to model reliably.

## The Principle

Technologies often described as "boring" tend to be easier for agents to work with due to three factors:

1. **Composability** — Simple, well-defined interfaces that combine predictably
2. **API stability** — Fewer breaking changes means agent knowledge stays valid longer
3. **Training set representation** — Widely used technologies have more examples in the model's training data, leading to higher-quality code generation

## Why This Matters for Agent-First Development

When agents encounter an unfamiliar or poorly documented API, they make up plausible-looking but incorrect code. With boring technology:

- The correct usage patterns are well-established
- Edge cases are well-documented
- Error messages are informative and searchable
- Community knowledge is abundant

## Decision Framework

When choosing between technologies for an agent-first project:

| Factor | Prefer | Avoid |
|--------|--------|-------|
| **Maturity** | 5+ year track record, stable API | Bleeding-edge, pre-1.0, rapidly changing |
| **Documentation** | Comprehensive official docs, many examples | Sparse docs, "read the source" culture |
| **Complexity** | Simple API surface, few concepts | Large API surface, many interacting concepts |
| **Convention** | Strong conventions, one way to do things | Multiple paradigms, high flexibility |
| **Debuggability** | Clear error messages, good tooling | Opaque errors, magic behavior |

## The "Reimplement vs. Depend" Tradeoff

OpenAI's harness engineering experiment found that in some cases, it was cheaper to have agents **reimplement a subset of functionality** than to work around opaque upstream behavior from complex libraries.

Consider reimplementing when:
- The library has a large API surface but you only need a small slice
- The library has implicit behavior or "magic" that confuses agents
- The library's error messages are unhelpful for agent self-correction
- Wrapping the library requires more code than reimplementing the needed subset

## Practical Guidelines

1. **Standard library first** — Before adding a dependency, check if the language's standard library can do the job
2. **Fewer dependencies** — Each dependency is a potential source of agent confusion. Prefer fewer, well-understood libraries over many specialized ones
3. **Explicit over implicit** — Choose libraries with explicit configuration over convention-based "magic"
4. **Wrap external dependencies** — When you must use a complex library, wrap it behind a simple interface in the infrastructure layer. This limits the blast radius of API changes and agent confusion
5. **Document non-obvious usage** — If a dependency has gotchas or non-intuitive patterns, document them in the project's `docs/references/` directory
