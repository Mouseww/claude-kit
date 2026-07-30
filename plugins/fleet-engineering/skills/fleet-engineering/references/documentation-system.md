# Documentation System

> How to organize knowledge so humans, agents, and a whole team can navigate it without trampling each other.

## The Documentation Hierarchy

```
Root (entry points)
├── AGENTS.md          - Agent navigation map (~100 lines, links to everything)
├── ARCHITECTURE.md    - Layer rules and dependency diagram
├── README.md          - Human quick-start guide
├── CODEOWNERS         - Doc/code ownership routing (platform-specific location)

docs/ (knowledge base)
├── design-docs/       - Technical design decisions (HOW)
│   ├── index.md       - GENERATED registry
│   └── core-beliefs.md - Golden rules
├── product-specs/     - Product requirements (WHAT)
│   └── index.md       - GENERATED registry
├── exec-plans/        - Implementation roadmaps (WHEN + WHO via claims)
│   ├── index.md       - GENERATED registry (active + completed)
│   ├── active/        - Plans being executed; their claims are live locks
│   └── completed/     - Archived plans
├── tech-debt/         - ONE FILE PER ENTRY: TD-{TICKET}.md
│   └── index.md       - GENERATED registry
├── quality/           - ONE FILE PER AREA: {area}.md
├── references/        - External reference materials
└── QUALITY_SCORE.md   - GENERATED dashboard (from docs/quality/*)

tools/
└── docs_lint.py       - Linter + index generator (the only writer of GENERATED files)

.claude/ (the process itself, version-controlled)
├── skills/fleet-engineering/   - This methodology
├── agents/fleet-evaluator.md   - The audit subagent
├── hooks/block_generated_docs.py
└── settings.json               - Shared team settings + hooks
```

## Two Kinds of Files

| Kind | Who writes it | Conflict behavior |
|------|--------------|-------------------|
| **Leaf documents** (specs, designs, plans, debt entries, quality areas) | Humans and agents | Per-feature files; parallel work rarely collides |
| **Generated aggregates** (all index.md, QUALITY_SCORE.md) | Only `tools/docs_lint.py --fix` | Regenerated deterministically; a rebase conflict is resolved by re-running `--fix` |

This split is the team-scale fix for documentation merge conflicts: nobody hand-merges an index, ever. If git conflicts on a generated file, accept either side and re-run `--fix`.

## Frontmatter

Every leaf document begins with YAML frontmatter (full schema in `docs-automation.md`): type, title, status, owner, ticket, created, updated, plus type-specific fields (claims for plans, priority/area/resolved for debt, area/score/reviewed for quality). Frontmatter is the single source for everything the generated files display. Status lives only in frontmatter.

## Progressive Disclosure

Unchanged from harness engineering: **start shallow, go deep on demand.**

1. `AGENTS.md` is the entry point: a table of contents with links, under 100 lines.
2. Root docs (ARCHITECTURE.md, README.md) give quick context.
3. `docs/` directories contain the depth.

An agent should understand what the project is and where to find information by reading only AGENTS.md.

## Document Lifecycle

```
Draft -> In Review -> Approved (spec/design) / Active (plan) -> Completed (plan)
                                              \-> Superseded / Archived
```

- **Draft**: being written; implementation MUST NOT start against it
- **In Review**: docs-first PR open
- **Approved / Active**: merged to main and in effect; agents follow it; a plan's claims now lock
- **Completed**: plan finished and audited; claims released
- **Superseded**: replaced (must link successor); **Archived**: kept for history only

Statuses are gates enforced by the docs linter and the evaluator, not just labels. See `collaboration-controls.md` Control 4.

## Document Types and When to Write Them

| Type | When to Create | Template |
|------|---------------|----------|
| **Product Spec** | Defining a new feature or capability | `product-spec.md.tpl` |
| **Design Doc** | Significant architectural decisions | `design-doc.md.tpl` |
| **Execution Plan** | Planning phased implementation; claiming scope | `execution-plan.md.tpl` |
| **Tech Debt Entry** | Knowingly taking on debt, skipping a gate, waiving a docs PR | `tech-debt-entry.md.tpl` |
| **Quality Area** | After an audit touches an area | `quality-area.md.tpl` |

## The Feature Development Flow

```
Product Spec (WHAT)
    -> Design Doc (HOW)
    -> Execution Plan (WHEN + claims)
    -> DOCS-FIRST PR to main (team visibility + approval)
    -> Implementation (inside claims)
    -> Quality Audit (fleet-evaluator PASS)
    -> Code PR (human review)
```

Acceptance criteria from the spec become verification steps in the plan. Domain models from the design doc become entities in code. Claims from the plan become the team's conflict radar.

## "Main Is Source of Truth" Principle

The solo rule was "repo is source of truth." The team rule is sharper: **only the main branch is shared truth.**

- Decisions made in Slack or meetings must be encoded in `docs/` ON MAIN
- A spec or plan sitting on a feature branch is invisible to the team; merge docs first
- API contracts live in product specs, not external wikis
- Architecture rules live in ARCHITECTURE.md, enforced by tests
- The development process itself lives in `.claude/` in the repo, so every teammate and every agent runs the same version
