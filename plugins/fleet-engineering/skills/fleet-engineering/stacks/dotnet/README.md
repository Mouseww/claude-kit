# .NET Stack for Fleet Engineering

> Stack-specific guidance for .NET / C# projects following fleet engineering principles.

## Tech Stack

- **.NET 8+ / C#**
- **Architecture enforcement**: ArchUnitNET
- **Static analysis**: Roslyn analyzers (CA1852, nullable reference types)
- **Build config**: Directory.Build.props + .editorconfig
- **Test framework**: xUnit
- **CI**: GitHub Actions

## Stack Contents

### References

| File | Purpose |
|------|---------|
| `references/architecture-rules.md` | 4-layer onion architecture with .NET-specific dependency and package policies |
| `references/architecture-tests.md` | ArchUnitNET setup, base test file, extension patterns |
| `references/code-quality-enforcement.md` | Directory.Build.props, .editorconfig, naming conventions, CI gates |
| `references/project-initialization.md` | Step-by-step `dotnet new` scaffolding guide |
| `references/golden-rules.md` | 10 .NET-specific golden rules with enforcement mechanisms |

### Templates

| File | Purpose |
|------|---------|
| `templates/AGENTS.md.tpl` | Agent entry point with .NET build commands and constraints |
| `templates/ARCHITECTURE.md.tpl` | Layer diagram with .NET project names and ArchUnitNET enforcement |
| `templates/README.md.tpl` | Project readme with `dotnet` quick start commands |
| `templates/core-beliefs.md.tpl` | Golden rules including C#-specific beliefs (sealed types, file-scoped namespaces, async) |
| `templates/ci-workflow.yml.tpl` | GitHub Actions CI with `dotnet restore/format/build/test` and self-healing messages |

## Key Commands

```bash
# Format check
dotnet format --verify-no-changes

# Build with warnings as errors
dotnet build --warnaserror

# Run all tests (including architecture tests)
dotnet test

# Run the API
dotnet run --project src/{ProjectName}.Api
```

## Mechanical Enforcement Summary

| Rule | Mechanism |
|------|-----------|
| Layer dependencies | ArchUnitNET tests in `Architecture.Tests` |
| Domain purity (zero external deps) | .csproj package inspection |
| Warnings are errors | `Directory.Build.props` -> `TreatWarningsAsErrors` |
| Code formatting | `.editorconfig` + `dotnet format` in CI |
| Sealed types | CA1852 via `AnalysisLevel=latest-recommended` |
| File-scoped namespaces | `.editorconfig` -> `csharp_style_namespace_declarations` |
| Async naming | `.editorconfig` -> naming rules |
