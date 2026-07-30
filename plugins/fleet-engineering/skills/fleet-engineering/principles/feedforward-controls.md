# Feedforward Controls (Guides)

> Controls that steer agents **before** they act — increasing the probability of correct output on the first attempt.

## What Are Feedforward Controls?

Feedforward controls anticipate unwanted behavior and guide agents toward correct actions proactively. They are the "steering" half of the harness — shaping agent behavior before any code is written.

The metaphor: a harness in horsemanship channels a powerful animal in a productive direction. The horse doesn't choose where to go; the rider steers through the harness.

## Types of Feedforward Controls

### 1. Structural Guides

Controls embedded in the project structure itself:

| Guide | How It Steers | Example |
|-------|--------------|---------|
| **AGENTS.md** | Provides navigation map and critical constraints | "Domain layer has ZERO external dependencies" |
| **ARCHITECTURE.md** | Defines allowed/forbidden dependencies | Layer diagram with dependency arrows |
| **Directory structure** | Physically separates concerns into layers | `src/Domain/`, `src/Application/`, `src/Infrastructure/` |
| **Naming conventions** | Makes intent explicit in names | Interfaces prefixed with `I`, async methods suffixed with `Async` |

### 2. Documentation Guides

Knowledge that informs agent decisions:

| Guide | How It Steers | Example |
|-------|--------------|---------|
| **Product specs** | Define WHAT to build | Requirements in F1.1 format, acceptance criteria in AC1 format |
| **Design docs** | Define HOW to build it | Domain model, data flow, layer responsibilities |
| **Execution plans** | Define WHEN to build each piece | Phased deliverables with dependencies |
| **Core beliefs** | Define the rules of the game | "Mechanical enforcement over documentation" |

### 3. Type System Guides

The programming language's type system as a feedforward control:

- **Strong typing** reduces the space of valid programs agents can write
- **Interface definitions** in inner layers tell agents exactly what to implement
- **Nullable annotations** prevent null-related bugs at compile time
- **Sealed/final types** prevent unintended inheritance hierarchies

## Design Principles for Feedforward Controls

1. **Be specific, not aspirational** — "Domain has zero external dependencies" is enforceable. "Keep code clean" is not.
2. **Front-load context** — Put the most critical constraints in AGENTS.md, not buried in deep docs.
3. **Reduce variety** — Committing to specific patterns (e.g., one service topology, one error handling pattern) narrows the output space, making it easier for agents to produce conforming code.
4. **Make the right path the easy path** — If the project structure, templates, and conventions all point toward the correct approach, agents will follow naturally.

## Relationship to Feedback Controls

Feedforward and feedback controls work together as a **steering loop**:

```
Feedforward (Guides)          Feedback (Sensors)
     │                              │
     ▼                              ▼
  Agent acts  ──────────────►  CI/tests detect
                                    │
                                    ▼
                              Self-healing message
                                    │
                                    ▼
                              Agent self-corrects
                                    │
                 ┌──────────────────┘
                 ▼
  Human updates guides based on recurring failures
```

When a feedback control catches the same mistake repeatedly, the right response is to add or improve a feedforward control that prevents it.
