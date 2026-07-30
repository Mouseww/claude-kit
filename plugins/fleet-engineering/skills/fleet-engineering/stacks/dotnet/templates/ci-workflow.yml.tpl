# GitHub Actions CI for a fleet-engineering .NET repo.
# Bitbucket users: see bitbucket-pipelines.yml.tpl instead.
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  docs-gates:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Docs lint (frontmatter, generated indexes, links, claims)
        run: |
          if ! python tools/docs_lint.py --check; then
            echo ""
            echo "=========================================="
            echo "DOCS LINT FAILED"
            echo "=========================================="
            echo "The messages above are self-healing: each names the file,"
            echo "the rule, and the fix. Most common fix:"
            echo "  python tools/docs_lint.py --fix   # then commit"
            echo "Reference: .claude/skills/fleet-engineering/references/docs-automation.md"
            echo "=========================================="
            exit 1
          fi

      - name: Plan-reference gate (docs-first enforcement)
        if: github.event_name == 'pull_request'
        run: |
          BRANCH="${{ github.head_ref }}"
          case "$BRANCH" in
            feature/*)
              TICKET=$(echo "$BRANCH" | sed -E 's#^feature/([A-Za-z]+-[0-9]+).*#\1#')
              if ! ls docs/exec-plans/active/${TICKET}-*.md docs/exec-plans/completed/${TICKET}-*.md 2>/dev/null | grep -q .; then
                echo "=========================================="
                echo "PLAN-REFERENCE GATE FAILED"
                echo "=========================================="
                echo "Branch '$BRANCH' implements ticket '$TICKET' but no exec plan"
                echo "named docs/exec-plans/active/${TICKET}-*.md exists on this branch."
                echo ""
                echo "Fleet engineering is docs-first: the spec/design/plan must merge"
                echo "to main BEFORE implementation. How to fix:"
                echo "  1. Create the plan from the execution-plan template"
                echo "  2. Open a docs-only PR (branch docs/${TICKET}-...) and merge it"
                echo "  3. Rebase this branch on main"
                echo "If this is a user-waived urgent fix, add docs/tech-debt/TD-${TICKET}-docs-waiver.md"
                echo "and rerun (the gate accepts a waiver entry)."
                echo "=========================================="
                ls docs/tech-debt/TD-${TICKET}-docs-waiver.md 2>/dev/null || exit 1
              fi
              ;;
            *) echo "Branch '$BRANCH' is not an implementation branch; gate skipped." ;;
          esac

  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: "8.0.x"

      - name: Restore dependencies
        run: dotnet restore

      - name: Check code format
        run: |
          if ! dotnet format --verify-no-changes --no-restore; then
            echo ""
            echo "=========================================="
            echo "CODE FORMAT CHECK FAILED"
            echo "=========================================="
            echo "How to fix: run 'dotnet format', commit, push."
            echo "Reference: .editorconfig for style rules"
            echo "=========================================="
            exit 1
          fi

      - name: Build with warnings as errors
        run: |
          if ! dotnet build --no-restore --warnaserror; then
            echo ""
            echo "=========================================="
            echo "BUILD FAILED"
            echo "=========================================="
            echo "Fix all warnings (treated as errors). Common: CA1852 seal internal"
            echo "types; nullable reference warnings; unused variables/imports."
            echo "Reference: Directory.Build.props"
            echo "=========================================="
            exit 1
          fi

      - name: Run tests
        run: |
          if ! dotnet test --no-build --verbosity normal; then
            echo ""
            echo "=========================================="
            echo "TESTS FAILED"
            echo "=========================================="
            echo "Architecture test failures indicate layer dependency violations:"
            echo "see ARCHITECTURE.md. Run 'dotnet test' locally to reproduce."
            echo "=========================================="
            exit 1
          fi

  # Scheduled sweep (Layer 3 garbage collection): staleness becomes failure here,
  # not on PRs. Surface results to the team (issue/ticket/chat).
  weekly-drift-sweep:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Strict docs sweep
        run: python tools/docs_lint.py --check --strict-stale

# To enable the weekly sweep, add to 'on:':
#   schedule:
#     - cron: "0 6 * * 1"
