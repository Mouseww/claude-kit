# Bitbucket Pipelines CI for a fleet-engineering .NET repo.
# Commit as bitbucket-pipelines.yml in the repo root.
# Full clone history is required so the plan-reference gate can diff against the PR
# destination branch.
image: mcr.microsoft.com/dotnet/sdk:8.0

clone:
  depth: full

definitions:
  steps:
    - step: &docs-gates
        name: Docs gates (lint + docs-first plan reference)
        image: python:3.12-slim
        script:
          - |
            python tools/docs_lint.py --check || {
              echo "==========================================";
              echo "DOCS LINT FAILED";
              echo "Most common fix: python tools/docs_lint.py --fix  # then commit";
              echo "Reference: .claude/skills/fleet-engineering/references/docs-automation.md";
              echo "==========================================";
              exit 1; }
          - |
            set -e
            if [ -z "$BITBUCKET_PR_ID" ]; then
              echo "Not a PR build; gate skipped."
              exit 0
            fi
            apt-get update -qq && apt-get install -y -qq git curl >/dev/null 2>&1

            git fetch origin "$BITBUCKET_PR_DESTINATION_BRANCH"
            BASE_REF="origin/$BITBUCKET_PR_DESTINATION_BRANCH"
            HEAD_REF="$BITBUCKET_COMMIT"

            fail() {
              echo "==========================================";
              echo "PLAN-REFERENCE GATE FAILED";
              echo "$1";
              echo "How to fix, pick one:";
              echo "  1. Add an exec plan on this branch: docs/exec-plans/active/{TICKET}-{slug}.md";
              echo "  2. Add a waiver on this branch: docs/tech-debt/TD-{TICKET}-docs-waiver.md";
              echo "  3. Light path only: put the five R2 signal values (S1-S5) in the PR";
              echo "     description inside a fleet-signals block, or, when";
              echo "     BITBUCKET_ACCESS_TOKEN is not configured and the PR description cannot";
              echo "     be read, in a commit message on this branch instead. CI checks the";
              echo "     block exists and is well-formed; the evaluator checks the values are";
              echo "     true.";
              echo "Docs and code ship in the same PR; there is no separate docs-only PR.";
              echo "==========================================";
              exit 1;
            }

            # Gate fires on diff content, not branch name.
            CHANGED_GATED=$(git diff --name-only "$BASE_REF" "$HEAD_REF" | grep -viE '(^docs/|\.md$|test)' || true)
            if [ -z "$CHANGED_GATED" ]; then
              echo "No non-test, non-doc source files changed; gate does not apply."
              exit 0
            fi

            PR_TITLE=""
            PR_BODY=""
            if [ -n "$BITBUCKET_ACCESS_TOKEN" ]; then
              PR_JSON=$(curl -s -H "Authorization: Bearer $BITBUCKET_ACCESS_TOKEN" \
                "https://api.bitbucket.org/2.0/repositories/$BITBUCKET_WORKSPACE/$BITBUCKET_REPO_SLUG/pullrequests/$BITBUCKET_PR_ID")
              PR_TITLE=$(printf '%s' "$PR_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("title",""))' 2>/dev/null || true)
              PR_BODY=$(printf '%s' "$PR_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("description",""))' 2>/dev/null || true)
            else
              echo "NOTE: BITBUCKET_ACCESS_TOKEN is not configured, so the PR title and"
              echo "description cannot be read from the REST API. Ticket resolution falls"
              echo "back to branch name and commit messages, and the light-path"
              echo "fleet-signals block must be placed in a commit message on this branch"
              echo "instead of the PR description. To resolve tickets and signals from the"
              echo "PR description too, add a 'Repository access token' pipeline variable"
              echo "named BITBUCKET_ACCESS_TOKEN (Repository settings > Access tokens)."
            fi

            # Light path: PR description carries the five R2 signals, all false.
            # When no access token is configured, PR_BODY is always empty, so fall back to
            # scanning commit messages on this branch for the same fleet-signals block.
            SIGNALS=$(printf '%s\n' "$PR_BODY" | sed -n '/<!-- fleet-signals -->/,/<!-- \/fleet-signals -->/p')
            if [ -z "$SIGNALS" ]; then
              SIGNALS=$(git log "$BASE_REF..$HEAD_REF" --format='%B' | sed -n '/<!-- fleet-signals -->/,/<!-- \/fleet-signals -->/p')
            fi
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
            for SRC in "$PR_TITLE" "$PR_BODY" "$BITBUCKET_BRANCH"; do
              T=$(printf '%s' "$SRC" | grep -oE '[A-Za-z]+-[0-9]+' | head -1 || true)
              if [ -n "$T" ]; then TICKET="$T"; break; fi
            done
            if [ -z "$TICKET" ]; then
              TICKET=$(git log "$BASE_REF..$HEAD_REF" --format='%s%n%b' | grep -oE '[A-Za-z]+-[0-9]+' | head -1 || true)
            fi
            if [ -z "$TICKET" ]; then
              fail "No ticket ID (PATTERN-123) found in the PR title, description, branch name, or commit messages."
            fi

            if ls docs/exec-plans/active/${TICKET}-*.md docs/exec-plans/completed/${TICKET}-*.md docs/tech-debt/TD-${TICKET}-docs-waiver.md 2>/dev/null | grep -q .; then
              exit 0
            fi
            fail "Branch implements ticket '$TICKET' but no exec plan or waiver exists on this branch."
    - step: &build-and-test
        name: Format + build (warnaserror) + tests
        caches: [dotnetcore]
        script:
          - dotnet restore
          - dotnet format --verify-no-changes --no-restore || { echo "FORMAT FAILED. Fix: dotnet format, commit, push."; exit 1; }
          - dotnet build --no-restore --warnaserror || { echo "BUILD FAILED. Fix all warnings; see Directory.Build.props."; exit 1; }
          - dotnet test --no-build --verbosity normal || { echo "TESTS FAILED. Architecture failures: see ARCHITECTURE.md."; exit 1; }

pipelines:
  pull-requests:
    "**":
      - step: *docs-gates
      - step: *build-and-test
  branches:
    main:
      - step: *docs-gates
      - step: *build-and-test
  custom:
    weekly-drift-sweep:   # schedule this in Repository settings > Pipelines > Schedules
      - step:
          name: Strict docs sweep (staleness + claim overlaps fail here)
          image: python:3.12-slim
          script:
            - python tools/docs_lint.py --check --strict-stale
