# Architecture Rules

> Defines the 4-layer onion architecture and how it is mechanically enforced.

## When to Use This Architecture

This 4-layer architecture is designed for **services with meaningful business logic** (domain rules, workflows, state machines).

For simple CRUD APIs or BFF (Backend-for-Frontend) proxies, a simpler 2-layer structure (Api + Infrastructure) is sufficient. Do not force 4 layers where 2 layers will do.

## The Four Layers

Fleet engineering projects use a strict layered architecture where dependencies flow inward:

```
┌─────────────────────────┐
│         Api             │  Entry point: controllers, DI, middleware
└────────────┬────────────┘
             ↓
┌─────────────────────────┐
│      Application        │  Use cases, workflows, interface definitions
└──────┬────────────┬─────┘
       ↓            ↓
┌────────────┐  ┌──────────────┐
│   Domain   │  │Infrastructure│  Implements Application interfaces
│ (pure, no  │  │ (external    │  with concrete technology
│  ext deps) │  │  packages)   │
└────────────┘  └──────┬───────┘
                       ↓
                ┌────────────┐
                │   Domain   │
                └────────────┘
```

## Dependency Rules

| Layer | Can Depend On | Cannot Depend On |
|-------|--------------|-----------------|
| Domain | BCL only (`System.*`) + approved pure-abstraction packages (see below) | Application, Infrastructure, Api, any package with I/O side effects |
| Application | Domain + orchestration packages (see below) | Infrastructure, Api |
| Infrastructure | Domain, Application | Api |
| Api | Application, Infrastructure (DI only) | — |

### Domain Layer Package Policy

Domain may reference **pure abstraction packages** with no I/O or side effects, such as `MediatR.Contracts`, `FluentValidation`, or `System.ComponentModel.Annotations`. Approved packages are maintained in a whitelist in `Directory.Build.props` or a dedicated `allowed-domain-packages.md`. Any addition requires team review.

### Application Layer Package Policy

Application may reference orchestration packages (e.g., `MediatR`, `Polly.Core`) but must NOT reference infrastructure-specific SDKs (e.g., `Azure.Storage.Blobs`, `Microsoft.EntityFrameworkCore`). The test: if removing the package would require changing a concrete technology choice, it belongs in Infrastructure.

## Why This Matters

- **Domain purity**: Business logic is testable without any external dependency. No database, no HTTP, no SDK.
- **Dependency inversion**: Application defines what it needs (interfaces); Infrastructure provides it. Swapping implementations (e.g., SQLite → PostgreSQL) doesn't touch business logic.
- **Testability**: Each layer can be tested in isolation. Domain tests for entities and value objects typically need zero mocks. Domain services that accept injected strategy interfaces may still require lightweight test doubles.

## Cross-Cutting Concerns

Authentication, telemetry, feature flags, and other cross-cutting concerns follow this pattern:

1. **Define interface** in Application (e.g., `ITelemetryProvider`)
2. **Implement** in Infrastructure (e.g., `ApplicationInsightsTelemetryProvider`)
3. **Register** via DI in Api's `Program.cs`

This keeps Application clean and Infrastructure swappable.

## Marker Class Pattern

Each source assembly contains a `Marker.cs` — a sealed, empty class used for reflection-based discovery:

```csharp
namespace {Name}.Domain;

public sealed class Marker { }
```

ArchUnitNET uses these markers to load assemblies and check dependency rules. Without them, the architecture tests cannot inspect the assembly's types.

## File Size Guidelines

| File Type | Soft Limit | Hard Limit | Preferred Metric |
|-----------|-----------|-----------|------------------|
| Source files | 500 | 800 | Cyclomatic complexity < 15 per method |
| Test classes | 300 | 500 | One test class per scenario/feature |

Soft limits are guidelines — agents should flag files approaching them. Hard limits require an ADR (see Exceptions below) to exceed. Line count alone is not a perfect proxy for complexity; prefer cyclomatic complexity and single-responsibility as the primary indicators.

## Mechanical Enforcement

| Rule | Enforcement Mechanism |
|------|----------------------|
| Layer dependencies | ArchUnitNET tests in `Architecture.Tests` |
| Domain has only whitelisted packages | .csproj packages checked against approved list |
| Warnings are errors | `Directory.Build.props` → `TreatWarningsAsErrors` |
| Code formatting | `.editorconfig` + `dotnet format` in CI |
| Sealed types | CA1852 via `AnalysisLevel=latest-recommended` |
| File-scoped namespaces | `.editorconfig` → `csharp_style_namespace_declarations` |

> **Note on TreatWarningsAsErrors**: When upgrading SDK or NuGet packages, new warnings may break the build. Use `<NoWarn>` in `Directory.Build.props` to suppress known false positives, and document each suppression with a comment. Avoid scattering `#pragma warning disable` in source files.

> **Note on CA1852 (sealed types)**: Test base classes and framework-required unsealed types are exempt. Suppress with `[SuppressMessage]` attribute and a justification string, not `#pragma`.

## Exceptions and Waivers

No rule set is absolute. Any deviation from the above rules must be recorded as an **Architecture Decision Record (ADR)** with the following fields:

- **Rule being waived** — which specific rule is being bypassed
- **Reason** — why the exception is necessary
- **Scope** — which project/file is affected
- **Reviewer sign-off** — at least one team member must approve

ADRs are stored in `_doc/adr/` and reviewed quarterly. If the same exception recurs across multiple projects, consider updating the rule itself.
