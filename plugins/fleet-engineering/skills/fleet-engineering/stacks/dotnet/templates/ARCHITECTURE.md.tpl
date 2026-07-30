# Architecture — {{ProjectName}}

> This document defines the layered architecture and dependency rules for the {{ProjectName}} codebase.
> Violations are enforced mechanically by ArchUnitNET tests — CI will reject non-conforming code.

## When to Use This Architecture

This 4-layer architecture is designed for **services with meaningful business logic** (domain rules, workflows, state machines).

For simple CRUD APIs or BFF (Backend-for-Frontend) proxies, a simpler 2-layer structure (Api + Infrastructure) is sufficient. Do not force 4 layers where 2 layers will do.

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    {{ProjectName}}.Api                       │
│               (Controllers, Middleware, DI)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ depends on
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                {{ProjectName}}.Application                   │
│           (Use Cases, Workflows, Interfaces)                │
└───────────┬─────────────────────────────────┬───────────────┘
            │ depends on                      │ depends on
            ▼                                 ▼
┌───────────────────────┐       ┌─────────────────────────────┐
│ {{ProjectName}}.Domain│       │{{ProjectName}}.Infrastructure│
│  (Entities, Values,   │       │  (Persistence, External APIs,│
│   Domain Services)    │       │   Telemetry, AI Clients)     │
│                       │       │                             │
│  ⚠ Only whitelisted   │       │  Implements interfaces      │
│    pure-abstraction   │       │  defined in Application     │
│    packages allowed   │       │                             │
└───────────────────────┘       └──────────────┬──────────────┘
                                               │ depends on
                                               ▼
                                    ┌───────────────────────┐
                                    │ {{ProjectName}}.Domain │
                                    └───────────────────────┘
```

## Dependency Rules

| Source Layer | Allowed Dependencies |
|-------------|---------------------|
| `{{ProjectName}}.Domain` | BCL (`System.*`) + approved pure-abstraction packages (see Package Policy below) |
| `{{ProjectName}}.Application` | `{{ProjectName}}.Domain` + orchestration packages (see Package Policy below) |
| `{{ProjectName}}.Infrastructure` | `{{ProjectName}}.Domain`, `{{ProjectName}}.Application` (for interface implementations), external NuGet packages |
| `{{ProjectName}}.Api` | `{{ProjectName}}.Application`, `{{ProjectName}}.Infrastructure` (for DI registration only) |

## Forbidden Dependencies

| Source Layer | MUST NOT Reference |
|-------------|-------------------|
| `{{ProjectName}}.Domain` | Any package with I/O side effects, Application, Infrastructure, Api |
| `{{ProjectName}}.Application` | Infrastructure, Api |
| `{{ProjectName}}.Infrastructure` | Api |

## Package Policy

### Domain Layer

Domain may reference **pure abstraction packages** with no I/O or side effects, such as `MediatR.Contracts`, `FluentValidation`, or `System.ComponentModel.Annotations`. Approved packages are maintained in a whitelist in `Directory.Build.props` or a dedicated `allowed-domain-packages.md`. Any addition requires team review.

### Application Layer

Application may reference orchestration packages (e.g., `MediatR`, `Polly.Core`) but must NOT reference infrastructure-specific SDKs (e.g., `Azure.Storage.Blobs`, `Microsoft.EntityFrameworkCore`). The test: if removing the package would require changing a concrete technology choice, it belongs in Infrastructure.

## Cross-Cutting Concerns

Cross-cutting concerns (auth, telemetry, feature flags) enter through **provider interfaces** defined in `{{ProjectName}}.Application` and implemented in `{{ProjectName}}.Infrastructure`.

## Enforcement

These rules are enforced by:
1. **ArchUnitNET tests** in `tests/{{ProjectName}}.Architecture.Tests/` — runs on every CI build
2. **Directory.Build.props** — global build settings including `TreatWarningsAsErrors`
3. **CI pipeline** — blocks merge on any violation

> **Note on TreatWarningsAsErrors**: When upgrading SDK or NuGet packages, new warnings may break the build. Use `<NoWarn>` in `Directory.Build.props` to suppress known false positives, and document each suppression with a comment. Avoid scattering `#pragma warning disable` in source files.

> **Note on CA1852 (sealed types)**: Test base classes and framework-required unsealed types are exempt. Suppress with `[SuppressMessage]` attribute and a justification string, not `#pragma`.

## File Size Guideline

| File Type | Soft Limit | Hard Limit | Preferred Metric |
|-----------|-----------|-----------|------------------|
| Source files | 500 | 800 | Cyclomatic complexity < 15 per method |
| Test classes | 300 | 500 | One test class per scenario/feature |

Soft limits are guidelines — agents should flag files approaching them. Hard limits require an ADR (see Exceptions below) to exceed. Line count alone is not a perfect proxy for complexity; prefer cyclomatic complexity and single-responsibility as the primary indicators.

## Exceptions and Waivers

Any deviation from the above rules must be recorded as an **Architecture Decision Record (ADR)** with the following fields:

- **Rule being waived** — which specific rule is being bypassed
- **Reason** — why the exception is necessary
- **Scope** — which project/file is affected
- **Reviewer sign-off** — at least one team member must approve

ADRs are stored in `_doc/adr/` and reviewed quarterly. If the same exception recurs across multiple projects, consider updating the rule itself.
