# Architecture Tests

> How to set up and extend ArchUnitNET layer enforcement tests.

## Setup

### NuGet Package

Add to your `{Name}.Architecture.Tests` project:

```bash
dotnet add tests/{Name}.Architecture.Tests package TngTech.ArchUnitNET.xUnit --version 0.13.3
```

### Project References

The architecture test project must reference ALL source projects:

```xml
<ItemGroup>
  <ProjectReference Include="..\..\src\{Name}.Domain\{Name}.Domain.csproj" />
  <ProjectReference Include="..\..\src\{Name}.Application\{Name}.Application.csproj" />
  <ProjectReference Include="..\..\src\{Name}.Infrastructure\{Name}.Infrastructure.csproj" />
  <ProjectReference Include="..\..\src\{Name}.Api\{Name}.Api.csproj" />
</ItemGroup>
```

## Base Test File

`LayerDependencyTests.cs` — the core layer enforcement:

```csharp
using ArchUnitNET.Domain;
using ArchUnitNET.Fluent;
using ArchUnitNET.Loader;
using ArchUnitNET.xUnit;
using static ArchUnitNET.Fluent.ArchRuleDefinition;

namespace {Name}.Architecture.Tests;

public class LayerDependencyTests
{
    private static readonly ArchUnitNET.Domain.Architecture Architecture =
        new ArchLoader()
            .LoadAssemblies(
                typeof(Domain.Marker).Assembly,
                typeof(Application.Marker).Assembly,
                typeof(Infrastructure.Marker).Assembly)
            .Build();

    private readonly IObjectProvider<IType> DomainLayer =
        Types().That().ResideInNamespace("{Name}.Domain").As("{Name}.Domain Layer");

    private readonly IObjectProvider<IType> ApplicationLayer =
        Types().That().ResideInNamespace("{Name}.Application").As("{Name}.Application Layer");

    private readonly IObjectProvider<IType> InfrastructureLayer =
        Types().That().ResideInNamespace("{Name}.Infrastructure").As("{Name}.Infrastructure Layer");

    [Fact]
    public void DomainShouldNotDependOnApplication()
    {
        IArchRule rule = Types().That().Are(DomainLayer)
            .Should().NotDependOnAny(ApplicationLayer)
            .Because(@"
ARCHITECTURE VIOLATION — Domain must not reference Application.

The Domain layer contains pure business entities and value objects.
It must have ZERO dependencies on other project layers.

How to fix:
  1. Move the dependent code to the Application layer
  2. If Domain needs a contract, define an interface in Domain
     and implement it in Application or Infrastructure
  3. See ARCHITECTURE.md for the full dependency diagram

Reference: ARCHITECTURE.md#dependency-rules");

        rule.Check(Architecture);
    }

    [Fact]
    public void DomainShouldNotDependOnInfrastructure()
    {
        IArchRule rule = Types().That().Are(DomainLayer)
            .Should().NotDependOnAny(InfrastructureLayer)
            .Because(@"
ARCHITECTURE VIOLATION — Domain must not reference Infrastructure.

The Domain layer is the innermost layer and must remain pure.
Infrastructure concerns (databases, AI clients, HTTP) belong
in the Infrastructure layer.

How to fix:
  1. Define an interface in {Name}.Domain or {Name}.Application
  2. Implement that interface in {Name}.Infrastructure
  3. Register the implementation via DI in {Name}.Api

Reference: ARCHITECTURE.md#dependency-rules");

        rule.Check(Architecture);
    }

    [Fact]
    public void ApplicationShouldNotDependOnInfrastructure()
    {
        IArchRule rule = Types().That().Are(ApplicationLayer)
            .Should().NotDependOnAny(InfrastructureLayer)
            .Because(@"
ARCHITECTURE VIOLATION — Application must not reference Infrastructure.

The Application layer defines use cases and workflows.
It should depend only on Domain types and its own interfaces.
Infrastructure implements those interfaces.

How to fix:
  1. Define an interface in {Name}.Application (e.g., IOrderRepository)
  2. Move the implementation to {Name}.Infrastructure
  3. Inject the interface via constructor injection

Reference: ARCHITECTURE.md#dependency-rules");

        rule.Check(Architecture);
    }
}
```

## Self-Healing Error Message Pattern

Every ArchUnitNET test uses `.Because()` with a structured message:

```
ARCHITECTURE VIOLATION — [What went wrong]

[Why this rule exists — 2-3 lines]

How to fix:
  1. [Specific action]
  2. [Specific action]
  3. [Specific action]

Reference: [document to consult]
```

This pattern ensures agents can self-correct when they violate architecture rules.

## Extending Architecture Tests

### Adding New Layer Rules

```csharp
[Fact]
public void InfrastructureShouldNotDependOnApi()
{
    // Add ApiLayer field first:
    // private readonly IObjectProvider<IType> ApiLayer =
    //     Types().That().ResideInNamespace("{Name}.Api").As("{Name}.Api Layer");

    IArchRule rule = Types().That().Are(InfrastructureLayer)
        .Should().NotDependOnAny(ApiLayer)
        .Because("Infrastructure must not reference Api. See ARCHITECTURE.md.");

    rule.Check(Architecture);
}
```

### Enforcing Naming Conventions

```csharp
[Fact]
public void InterfacesShouldStartWithI()
{
    IArchRule rule = Types().That().AreInterfaces()
        .Should().HaveNameStartingWith("I")
        .Because("All interfaces must be prefixed with 'I'. See AGENTS.md#naming-conventions.");

    rule.Check(Architecture);
}
```

### Enforcing Sealed Types

```csharp
[Fact]
public void DomainEntitiesShouldBeSealed()
{
    IArchRule rule = Types().That().Are(DomainLayer)
        .And().AreNotAbstract()
        .And().AreNotInterfaces()
        .Should().BeSealed()
        .Because("Domain types must be sealed unless designed for inheritance. CA1852.");

    rule.Check(Architecture);
}
```

## Tips

- Load only the assemblies you need via `Marker` classes
- Keep each test focused on one rule
- Architecture tests run on every build — keep them fast
- When a test fails in CI, the self-healing message guides the agent to fix it
