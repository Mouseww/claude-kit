# Bitbucket Pipelines CI for a fleet-engineering .NET repo.
# Commit as bitbucket-pipelines.yml in the repo root.
image: mcr.microsoft.com/dotnet/sdk:8.0

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
            case "$BITBUCKET_BRANCH" in
              feature/*)
                TICKET=$(echo "$BITBUCKET_BRANCH" | sed -E 's#^feature/([A-Za-z]+-[0-9]+).*#\1#')
                if ! ls docs/exec-plans/active/${TICKET}-*.md docs/exec-plans/completed/${TICKET}-*.md 2>/dev/null | grep -q .; then
                  echo "==========================================";
                  echo "PLAN-REFERENCE GATE FAILED";
                  echo "Branch implements '$TICKET' but no exec plan {TICKET}-*.md exists.";
                  echo "Fleet engineering is docs-first: merge the docs PR before coding.";
                  echo "Waiver path: docs/tech-debt/TD-${TICKET}-docs-waiver.md";
                  echo "==========================================";
                  ls docs/tech-debt/TD-${TICKET}-docs-waiver.md 2>/dev/null || exit 1;
                fi ;;
              *) echo "Not an implementation branch; gate skipped." ;;
            esac
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
