# {{ProjectName}}

<!-- INSTRUCTION: One paragraph project description. What does this project do and for whom? -->

## Tech Stack

- **.NET 8 / C#**
- **Architecture**: Layered Domain Architecture with mechanical enforcement
<!-- INSTRUCTION: Add additional tech stack items (AI provider, database, cloud services, etc.) -->

## Quick Start

```bash
# Restore dependencies
dotnet restore

# Build (warnings treated as errors)
dotnet build --warnaserror

# Run all tests (including architecture tests)
dotnet test

# Check code formatting
dotnet format --verify-no-changes

# Run the API
dotnet run --project src/{{ProjectName}}.Api
```

## Project Structure

```
{{ProjectName}}/
├── AGENTS.md                  # Agent entry point — read this first
├── ARCHITECTURE.md            # Layer rules and dependency diagram
├── src/
│   ├── {{ProjectName}}.Domain/           # Core entities (zero external deps)
│   ├── {{ProjectName}}.Application/      # Use cases and workflows
│   ├── {{ProjectName}}.Infrastructure/   # External integrations, persistence
│   └── {{ProjectName}}.Api/              # Web API entry point
├── tests/
│   ├── {{ProjectName}}.Domain.Tests/
│   ├── {{ProjectName}}.Application.Tests/
│   └── {{ProjectName}}.Architecture.Tests/  # ArchUnitNET layer enforcement
├── docs/                      # Knowledge base (source of truth)
│   ├── design-docs/           # Design decisions & golden rules
│   ├── exec-plans/            # Execution plans & tech debt
│   ├── product-specs/         # Product specifications
│   └── references/            # External reference materials
└── .github/workflows/ci.yml   # CI pipeline
```

## Fleet Engineering Principles

This project follows the fleet engineering methodology:

1. **Repo as system of record** — All knowledge lives in version-controlled files
2. **Mechanical enforcement** — Architecture rules enforced by ArchUnitNET tests, not documentation alone
3. **Self-healing error messages** — Build/test failures include fix instructions for agents
4. **Progressive disclosure** — `AGENTS.md` is a short map pointing to deeper sources of truth
5. **Golden rules** — Core beliefs encoded in `docs/design-docs/core-beliefs.md`

## For Agents

Start with [`AGENTS.md`](./AGENTS.md) — it is your entry point and table of contents.
