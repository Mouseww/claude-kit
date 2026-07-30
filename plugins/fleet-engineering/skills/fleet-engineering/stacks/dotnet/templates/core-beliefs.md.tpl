# Core Beliefs — Golden Rules

> These are opinionated, mechanical rules that keep the codebase readable and
> consistent for future agent runs. They are enforced by linters, tests, and CI.

## Architecture Beliefs

1. **Layer isolation is non-negotiable** — Domain has zero external dependencies.
   Application depends only on Domain. Infrastructure implements interfaces.
   Violations are caught by ArchUnitNET tests.

2. **Parse at boundaries, never trust raw input** — Validate and parse data shapes
   at domain boundaries. Use strongly typed models internally. Never pass raw
   strings or unvalidated JSON through the system.

3. **Prefer shared utilities over hand-rolled helpers** — Centralize invariants in
   shared utility packages so fixes propagate everywhere. Do not duplicate logic
   across domains.

## Code Quality Beliefs

4. **Structured logging only** — Always use structured logging with message
   templates. Never use string interpolation in log messages.
   ```csharp
   // WRONG
   logger.LogInformation($"Processing item {itemId}");

   // RIGHT
   logger.LogInformation("Processing item {ItemId}", itemId);
   ```

5. **Seal what you can** — Types with no subtypes and not externally visible
   should be sealed. This is enforced by CA1852 with `TreatWarningsAsErrors`.

6. **File-scoped namespaces** — All C# files must use file-scoped namespace
   declarations. Enforced via `.editorconfig`.

7. **Async all the way** — Async methods must be suffixed with `Async`.
   Never block on async code with `.Result` or `.Wait()`.

## Agent Workflow Beliefs

8. **The repo is the source of truth** — If it is not in the repo, it does not
   exist for the agent. Slack discussions, Google Docs, and verbal agreements
   must be encoded as Markdown in `docs/` to be actionable.

9. **Small, focused PRs** — Each change should be a single logical unit.
   Prefer many small PRs over one large one.

10. **Mechanical enforcement over documentation** — When a rule can be encoded
    as a test, linter, or analyzer, do that instead of just documenting it.
    Documentation explains *why*; code enforces *what*.

<!-- INSTRUCTION: Add project-specific beliefs below. For each belief, specify:
     - The rule itself
     - How it is enforced (ArchUnitNET, EditorConfig, CI, analyzer, etc.)
     - Why it matters for this project -->
