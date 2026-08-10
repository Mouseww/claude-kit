# AGENTS.md - Agent Entry Point

> Table of contents for agents working in this repository. Keep it short (~100 lines).
> This is a FLEET ENGINEERING repo: multiple humans + agents work in parallel.
> The process itself lives in `.claude/skills/fleet-engineering/`; read it for any
> development request.

## Project Overview

**{{ProjectName}}** - <!-- INSTRUCTION: One-line project description -->
- **Tech Stack**: .NET 8 / C#
- **Architecture**: Layered Domain Architecture with strict dependency rules
- **Team process**: fleet engineering (docs written first on the implementation branch, claims, generated indexes, mandatory audit)

## Quick Navigation

| Topic | Location |
|-------|----------|
| Architecture rules & layer diagram | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Core beliefs / golden rules | [docs/design-docs/core-beliefs.md](./docs/design-docs/core-beliefs.md) |
| Execution plans (GENERATED index) | [docs/exec-plans/index.md](./docs/exec-plans/index.md) |
| Product specs (GENERATED index) | [docs/product-specs/index.md](./docs/product-specs/index.md) |
| Design docs (GENERATED index) | [docs/design-docs/index.md](./docs/design-docs/index.md) |
| Tech debt (one file per entry) | [docs/tech-debt/index.md](./docs/tech-debt/index.md) |
| Quality dashboard (GENERATED) | [docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md) |
| Team coordination rules | `.claude/skills/fleet-engineering/references/collaboration-controls.md` |
| Docs automation rules | `.claude/skills/fleet-engineering/references/docs-automation.md` |

## Critical Constraints (MUST follow)

1. **Build must pass**: `dotnet build --warnaserror` and `dotnet test`
2. **Architecture enforcement**: layer dependencies enforced by ArchUnitNET tests; CI fails on violations
3. **Code format**: `dotnet format --verify-no-changes` before submitting
4. **Domain purity**: `{{ProjectName}}.Domain` has ZERO external NuGet dependencies
5. **Docs lint**: `python tools/docs_lint.py --check` must pass; run `--fix` after editing any doc
6. **Docs first, same branch**: spec/design/plan are authored and committed on the implementation branch before the first implementation commit (status In Review); implementation MUST NOT start while a required doc is still Draft
7. **Claims**: stay inside your exec plan's claims; amend the Claims section before touching new paths
8. **Audit**: every development request ends with a `fleet-evaluator` PASS before the code PR opens

## Prohibited Actions

- Do NOT hand-edit GENERATED files (any `docs/**/index.md`, `docs/QUALITY_SCORE.md`); a hook blocks this; run `python tools/docs_lint.py --fix`
- Do NOT invent sequential doc numbers; use ticket IDs (`PIEX-1234-slug.md`)
- Do NOT start implementation against a Draft spec or plan; `In Review` is the working state for the implementation phase and is not a blocker
- Do NOT modify `AGENTS.md`, CODEOWNERS, `.claude/`, or `tools/docs_lint.py` without team-lead approval (CODEOWNERS enforces)
- Do NOT edit another plan's Claims section to unblock yourself; negotiate with its owner
- Do NOT bypass architecture tests, add NuGet packages to Domain, use unstructured logging, or commit secrets

## Module Skills Map

<!-- INSTRUCTION: Map modules/concerns to the domain skills that teach how to work on them.
     Planning agents read this table to fill the exec plan's "Relevant Skills" section;
     implementing agents load the skill when entering a phase that touches the module.
     Domain skills are committed in .claude/skills/ alongside fleet-engineering.
     Precedence: fleet-engineering governs workflow/gates; these skills govern mechanics. -->

| Module / Concern | Skill | Use it when |
|------------------|-------|-------------|
| <!-- e.g., AI repair engine --> | <!-- e.g., rawdata-repair --> | <!-- e.g., creating/altering repair handlers --> |
| <!-- e.g., Extraction DTOs --> | <!-- e.g., json-to-model --> | <!-- e.g., new GPT extraction schema --> |
| Commit & push | <!-- e.g., git-push --> | All commits (its message template overrides fleet's examples) |

## Naming Conventions

- Interfaces `I*`; async methods `*Async`; test classes `*Tests`; tests `MethodName_Scenario_ExpectedResult`
- Branches: one branch per change, `feature/{TICKET}-{slug}` (or `fix/{TICKET}-{slug}` for bug fixes); docs and code both live on this branch, there is no separate docs branch
- Commits: `feat({TICKET}): ...` conventional style

## How to Work in This Repo

1. **Read the map first**: this file, then follow links
2. **Pre-flight**: `git fetch --all --prune`; read `docs/exec-plans/active/*.md` from `origin/*` branches and open PRs (not main); check claim overlaps
3. **Docs first, same branch**: spec/design/plan committed on the implementation branch, status In Review, before the first implementation commit -> then code, same branch
4. **Run locally before submitting**:
   ```bash
   dotnet format && dotnet build --warnaserror && dotnet test
   python tools/docs_lint.py --check
   ```
5. **Audit**: spawn `fleet-evaluator` (defined in `.claude/agents/fleet-evaluator.md`) and reach PASS before opening the PR

## Handling Development Requests

Follow `.claude/skills/fleet-engineering/SKILL.md` "Development Request Procedure". Summary:

1. Classify: feature | enhancement | bug fix | refactor | config
2. Pre-flight claims check against active plans on remote branches and open PRs (Step 0)
3. Spec/design/plan committed on the same branch before implementation starts (templates in `.claude/skills/fleet-engineering/templates/`)
4. Implement phase by phase inside claims; format/build/test after each phase
5. Step E: bookkeeping, `docs_lint.py --fix`, then `fleet-evaluator` audit loop to PASS
6. Code PR with ticket + plan link + evaluator summary

## Agent Review Checklist (before any PR)

- [ ] `dotnet build --warnaserror` passes; all tests pass; `dotnet format --verify-no-changes` clean
- [ ] `python tools/docs_lint.py --check` passes
- [ ] Docs updated if behavior changed; frontmatter `updated` bumped
- [ ] Evaluator PASS (code PRs)
- [ ] No secrets in code
