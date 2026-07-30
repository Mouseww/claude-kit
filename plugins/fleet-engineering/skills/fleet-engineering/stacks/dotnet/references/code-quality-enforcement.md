# Code Quality Enforcement

> Every code quality rule should be mechanically enforced. Documentation explains why; code enforces what.

## Directory.Build.props

This file lives at the solution root and applies to ALL projects:

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

| Setting | Purpose |
|---------|---------|
| `TreatWarningsAsErrors` | Zero-warning policy — forces all issues to be resolved |
| `EnforceCodeStyleInBuild` | EditorConfig rules checked during build |
| `AnalysisLevel=latest-recommended` | Enables CA analyzers including CA1852 (seal types) |
| `Nullable=enable` | Nullable reference types — catches null bugs at compile time |
| `ImplicitUsings=enable` | Reduces boilerplate `using` statements |

## .editorconfig

Complete `.editorconfig` for fleet engineering projects:

```ini
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.{cs,csx}]
indent_size = 4

# C# formatting rules
csharp_new_line_before_open_brace = all
csharp_new_line_before_else = true
csharp_new_line_before_catch = true
csharp_new_line_before_finally = true
csharp_indent_case_contents = true
csharp_indent_switch_labels = true
csharp_space_after_cast = false
csharp_space_after_keywords_in_control_flow_statements = true
csharp_space_between_method_declaration_parameter_list_parentheses = false
csharp_space_between_method_call_parameter_list_parentheses = false
csharp_preserve_single_line_statements = false
csharp_preserve_single_line_blocks = true

# var usage
csharp_style_var_for_built_in_types = false:suggestion
csharp_style_var_when_type_is_apparent = true:suggestion
csharp_style_var_elsewhere = false:suggestion

# Expression-bodied members
csharp_style_expression_bodied_methods = when_on_single_line:suggestion
csharp_style_expression_bodied_properties = true:suggestion
csharp_style_expression_bodied_accessors = true:suggestion

# File-scoped namespaces (enforced)
csharp_style_namespace_declarations = file_scoped:warning

# Interface naming: must start with I
dotnet_naming_rule.interface_should_begin_with_i.severity = warning
dotnet_naming_rule.interface_should_begin_with_i.symbols = interface
dotnet_naming_rule.interface_should_begin_with_i.style = begins_with_i

dotnet_naming_symbols.interface.applicable_kinds = interface
dotnet_naming_symbols.interface.applicable_accessibilities = public, internal, private, protected, protected_internal, private_protected

dotnet_naming_style.begins_with_i.required_prefix = I
dotnet_naming_style.begins_with_i.capitalization = pascal_case

# Async method naming: must end with Async
dotnet_naming_rule.async_methods_should_end_with_async.severity = warning
dotnet_naming_rule.async_methods_should_end_with_async.symbols = async_methods
dotnet_naming_rule.async_methods_should_end_with_async.style = ends_with_async

dotnet_naming_symbols.async_methods.applicable_kinds = method
dotnet_naming_symbols.async_methods.required_modifiers = async

dotnet_naming_style.ends_with_async.required_suffix = Async
dotnet_naming_style.ends_with_async.capitalization = pascal_case

# Organize usings
dotnet_sort_system_directives_first = true
dotnet_separate_import_directive_groups = false

[*.md]
trim_trailing_whitespace = false
indent_size = 2

[*.{json,yml,yaml}]
indent_size = 2

[*.{props,targets,csproj,sln}]
indent_size = 2
```

## Naming Conventions

| Element | Convention | Enforcement |
|---------|-----------|-------------|
| Interfaces | `I` prefix (e.g., `IOrderService`) | EditorConfig warning |
| Async methods | `Async` suffix (e.g., `ProcessAsync`) | EditorConfig warning |
| Test classes | `Tests` suffix (e.g., `OrderServiceTests`) | Convention (PR review) |
| Test methods | `Method_Scenario_Expected` (e.g., `Create_ValidInput_ReturnsOrder`) | Convention (PR review) |
| Namespaces | File-scoped | EditorConfig warning |
| Internal types | Sealed if no subtypes | CA1852 (build error) |

## Structured Logging

Always use message templates, never string interpolation:

```csharp
// WRONG — string interpolation
logger.LogInformation($"Processing order {orderId} for {customer}");

// RIGHT — structured logging template
logger.LogInformation("Processing order {OrderId} for {Customer}", orderId, customer);
```

Why: Structured logging enables querying by field name in observability tools. Interpolated strings lose the field semantics.

## CI Pipeline Gates

The CI pipeline enforces quality in three gates, each with self-healing error messages:

1. **Format Check**: `dotnet format --verify-no-changes`
   - Catches EditorConfig violations
   - Fix: `dotnet format` locally

2. **Build**: `dotnet build --warnaserror`
   - Catches analyzer warnings (CA1852, nullable, unused code)
   - Fix: address each warning specifically

3. **Test**: `dotnet test`
   - Catches architecture violations (ArchUnitNET) + logic bugs
   - Fix: check ARCHITECTURE.md for layer rules

Each gate's failure message includes specific fix instructions so agents can self-correct without external guidance. See `templates/ci-workflow.yml.tpl` for the full pipeline.

## Self-Healing Error Messages

The principle: every automated failure should tell the agent how to fix it. This applies to:

- CI pipeline steps (format, build, test)
- ArchUnitNET test assertions
- Any custom validation

Pattern:
```
========================================
[WHAT FAILED]
========================================

How to fix:
  1. [Specific step]
  2. [Specific step]

Reference: [doc to consult for details]
========================================
```
