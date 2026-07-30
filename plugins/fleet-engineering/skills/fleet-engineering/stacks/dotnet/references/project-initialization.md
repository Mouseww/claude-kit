# Project Initialization Guide (.NET, fleet engineering)

> How to scaffold a new .NET TEAM project. Identical to the harness (solo) scaffold for
> code structure; the differences are the docs layout, the generated indexes, and Step 11
> (committing the process into the repo).

## Prerequisites

- .NET 8 SDK installed
- Python 3.8+ available locally and in CI (for `tools/docs_lint.py`)
- Git initialized; remote with PR support (Bitbucket / GitHub) and required-reviewer settings

## Step 1: Create Solution and Projects

Replace `{Name}` with your project name throughout.

```bash
dotnet new sln -n {Name}

dotnet new classlib -n {Name}.Domain -o src/{Name}.Domain
dotnet new classlib -n {Name}.Application -o src/{Name}.Application
dotnet new classlib -n {Name}.Infrastructure -o src/{Name}.Infrastructure
dotnet new web -n {Name}.Api -o src/{Name}.Api

dotnet new xunit -n {Name}.Domain.Tests -o tests/{Name}.Domain.Tests
dotnet new xunit -n {Name}.Application.Tests -o tests/{Name}.Application.Tests
dotnet new xunit -n {Name}.Architecture.Tests -o tests/{Name}.Architecture.Tests

dotnet sln add src/{Name}.Domain --solution-folder src
dotnet sln add src/{Name}.Application --solution-folder src
dotnet sln add src/{Name}.Infrastructure --solution-folder src
dotnet sln add src/{Name}.Api --solution-folder src
dotnet sln add tests/{Name}.Domain.Tests --solution-folder tests
dotnet sln add tests/{Name}.Application.Tests --solution-folder tests
dotnet sln add tests/{Name}.Architecture.Tests --solution-folder tests
```

## Step 2: Set Up Project References

```bash
dotnet add src/{Name}.Application reference src/{Name}.Domain

dotnet add src/{Name}.Infrastructure reference src/{Name}.Domain
dotnet add src/{Name}.Infrastructure reference src/{Name}.Application

dotnet add src/{Name}.Api reference src/{Name}.Application
dotnet add src/{Name}.Api reference src/{Name}.Infrastructure

dotnet add tests/{Name}.Domain.Tests reference src/{Name}.Domain
dotnet add tests/{Name}.Application.Tests reference src/{Name}.Domain
dotnet add tests/{Name}.Application.Tests reference src/{Name}.Application

dotnet add tests/{Name}.Architecture.Tests reference src/{Name}.Domain
dotnet add tests/{Name}.Architecture.Tests reference src/{Name}.Application
dotnet add tests/{Name}.Architecture.Tests reference src/{Name}.Infrastructure
dotnet add tests/{Name}.Architecture.Tests reference src/{Name}.Api
```

## Step 3: Clean Up Domain Project

The Domain project must have ZERO external NuGet packages. Its `.csproj` should only contain:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
```

Remove auto-generated Class1.cs files from all projects.

## Step 4: Add Marker Classes

Each source project gets a `Marker.cs` for ArchUnitNET discovery:

```csharp
namespace {Name}.Domain;

/// <summary>
/// Assembly marker type used for reflection-based discovery (e.g., ArchUnitNET tests).
/// Do not add any members to this class.
/// </summary>
public sealed class Marker
{
}
```

Repeat for Application and Infrastructure (adjust namespace).

## Step 5: Add ArchUnitNET to Architecture Tests

```bash
dotnet add tests/{Name}.Architecture.Tests package TngTech.ArchUnitNET.xUnit --version 0.13.3
```

Create `LayerDependencyTests.cs`; see `references/architecture-tests.md`.

## Step 6: Create Directory Structure

```bash
mkdir -p docs/design-docs docs/product-specs
mkdir -p docs/exec-plans/active docs/exec-plans/completed
mkdir -p docs/tech-debt docs/quality docs/references
mkdir -p tools .claude/agents .claude/hooks .claude/skills
```

Note vs the solo layout: `docs/tech-debt/` (one file per entry) and `docs/quality/`
(one file per area) replace the single tracker and dashboard files.

## Step 7: Create Root Configuration Files

From the methodology templates (`templates/`) and stack templates (`stacks/dotnet/templates/`):

| Template | Target Path |
|----------|------------|
| `AGENTS.md.tpl` (stack) | `AGENTS.md` |
| `ARCHITECTURE.md.tpl` (stack) | `ARCHITECTURE.md` |
| `README.md.tpl` (stack) | `README.md` |
| `core-beliefs.md.tpl` (stack) | `docs/design-docs/core-beliefs.md` |
| `ci-workflow.yml.tpl` (stack) | `.github/workflows/ci.yml` (GitHub) |
| `bitbucket-pipelines.yml.tpl` (stack) | `bitbucket-pipelines.yml` (Bitbucket) |

Replace all `{{ProjectName}}` placeholders. Do NOT hand-create the index files or
QUALITY_SCORE.md; Step 12 generates them.

## Step 8: Build Configuration Files

**`Directory.Build.props`** (root):

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <AnalysisLevel>latest-recommended</AnalysisLevel>
  </PropertyGroup>
</Project>
```

**`.editorconfig`**: see `references/code-quality-enforcement.md`.
**`.gitignore`**: `dotnet new gitignore`; add `.claude/settings.local.json`.

## Step 9: Set Up Api Entry Point

Replace the auto-generated `Program.cs` with a minimal health endpoint:

```csharp
WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

WebApplication app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { Status = "Healthy" }));

app.Run();
```

## Step 10: Commit the Process Into the Repo (fleet-specific, Layer 4)

The methodology travels WITH the repo so every teammate and agent runs the same version:

| Template | Target Path |
|----------|------------|
| the whole `fleet-engineering` skill directory | `.claude/skills/fleet-engineering/` |
| `fleet-evaluator.md.tpl` | `.claude/agents/fleet-evaluator.md` |
| `docs_lint.py.tpl` | `tools/docs_lint.py` |
| `settings.json.tpl` | `.claude/settings.json` |
| `block-generated-docs.py.tpl` | `.claude/hooks/block_generated_docs.py` |
| `CODEOWNERS.tpl` | platform location (`.github/CODEOWNERS`, or Bitbucket code-owner config) |

Then:

1. Fill CODEOWNERS with real owners; pair each code area with its design docs
2. Protect main: PRs required, required reviewers from CODEOWNERS, CI checks required
3. Changes to `.claude/`, `tools/docs_lint.py`, AGENTS.md, CODEOWNERS route to the team lead (already in the CODEOWNERS template)

## Step 11: Seed Quality Areas

Create one `docs/quality/{area}.md` from `quality-area.md.tpl` per architecture layer
(domain, application, infrastructure, api, tests, documentation). Initial score: honest, not aspirational.

## Step 12: Generate Indexes and Verify

```bash
python tools/docs_lint.py --fix     # generates all index.md + QUALITY_SCORE.md
python tools/docs_lint.py --check   # must exit 0
dotnet format
dotnet build --warnaserror
dotnet test
```

All commands must pass with zero errors and zero warnings.

## Post-Init Checklist

- [ ] Solution builds with `--warnaserror`; all tests pass (incl. architecture tests)
- [ ] Domain project has zero external NuGet packages; Marker.cs files present
- [ ] AGENTS.md, ARCHITECTURE.md, README.md created and customized
- [ ] docs/ hierarchy created; indexes GENERATED (not hand-written)
- [ ] `python tools/docs_lint.py --check` passes
- [ ] `.claude/skills/fleet-engineering/`, `.claude/agents/fleet-evaluator.md`, hooks, settings committed
- [ ] `tools/docs_lint.py` committed; CI includes docs gates + plan-reference gate
- [ ] CODEOWNERS populated with real owners; main branch protected
- [ ] Weekly drift sweep scheduled (CI cron / Bitbucket scheduled pipeline)
