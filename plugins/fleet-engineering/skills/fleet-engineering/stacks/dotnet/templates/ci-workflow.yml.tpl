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
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
          BRANCH: ${{ github.head_ref }}
        run: |
          set -e

          fail() {
            echo ""
            echo "=========================================="
            echo "PLAN-REFERENCE GATE FAILED"
            echo "=========================================="
            echo "$1"
            echo ""
            echo "How to fix, pick one:"
            echo "  1. Add an exec plan on this branch: docs/exec-plans/active/{TICKET}-{slug}.md"
            echo "  2. Add a waiver on this branch: docs/tech-debt/TD-{TICKET}-docs-waiver.md"
            echo "  3. Light path only: put the five R2 signal values (S1-S5) in the PR"
            echo "     description inside a fleet-signals block. CI checks the block exists"
            echo "     and is well-formed; the evaluator checks the values are true."
            echo "Docs and code ship in the same PR; there is no separate docs-only PR."
            echo "Reference: .claude/skills/fleet-engineering/references/collaboration-controls.md"
            echo "=========================================="
            exit 1
          }

          # Gate fires on diff content, not branch name: any non-test, non-doc source
          # file touched by this PR triggers it.
          CHANGED_GATED=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" | grep -viE '(^docs/|\.md$|test)' || true)
          if [ -z "$CHANGED_GATED" ]; then
            echo "No non-test, non-doc source files changed; gate does not apply."
            exit 0
          fi

          # Light path: PR description carries the five R2 signals, all false.
          SIGNALS=$(printf '%s\n' "$PR_BODY" | sed -n '/<!-- fleet-signals -->/,/<!-- \/fleet-signals -->/p')
          if [ -n "$SIGNALS" ]; then
            MISSING=0
            for S in S1 S2 S3 S4 S5; do
              echo "$SIGNALS" | grep -qE "^${S}:[[:space:]]*(true|false)$" || MISSING=1
            done
            if [ "$MISSING" -eq 0 ] && ! echo "$SIGNALS" | grep -qE '^(S1|S2|S3|S4|S5):[[:space:]]*true$'; then
              echo "Light-path signals block present and well-formed (all S1-S5 false); gate satisfied."
              exit 0
            fi
          fi

          # Ticket resolution order: PR title -> PR description -> branch name -> commit messages.
          TICKET=""
          for SRC in "$PR_TITLE" "$PR_BODY" "$BRANCH"; do
            T=$(printf '%s' "$SRC" | grep -oE '[A-Za-z]+-[0-9]+' | head -1 || true)
            if [ -n "$T" ]; then TICKET="$T"; break; fi
          done
          if [ -z "$TICKET" ]; then
            TICKET=$(git log "$BASE_SHA..$HEAD_SHA" --format='%s%n%b' | grep -oE '[A-Za-z]+-[0-9]+' | head -1 || true)
          fi
          if [ -z "$TICKET" ]; then
            fail "No ticket ID (PATTERN-123) found in the PR title, PR description, branch name, or commit messages."
          fi

          # Exec plan (any status) reachable on this branch, or a docs waiver, satisfies the gate.
          if ls docs/exec-plans/active/${TICKET}-*.md docs/exec-plans/completed/${TICKET}-*.md docs/tech-debt/TD-${TICKET}-docs-waiver.md 2>/dev/null | grep -q .; then
            exit 0
          fi
          fail "Branch implements ticket '$TICKET' but no exec plan docs/exec-plans/{active,completed}/${TICKET}-*.md and no waiver docs/tech-debt/TD-${TICKET}-docs-waiver.md exist on this branch."

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
