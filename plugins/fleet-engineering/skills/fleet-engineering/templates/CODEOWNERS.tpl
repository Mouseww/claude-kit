# CODEOWNERS: routes PR review to the humans who guard each area.
# Location depends on platform:
#   GitHub: .github/CODEOWNERS (or repo root)   Bitbucket: use branch-restrictions /
#   default-reviewers per path via the "Code owners" feature or a PR-routing app.
#
# INSTRUCTION: replace placeholders with real usernames/groups. Keep code and its
# design docs under the SAME owner so one human brain arbitrates semantic doc conflicts.
# Review quarterly: an owner who left the team is a broken gate.

# ---- Process files: changes to the methodology itself need lead approval ----
/.claude/                       @{{TeamLead}}
/tools/docs_lint.py             @{{TeamLead}}
/CODEOWNERS                     @{{TeamLead}}
/AGENTS.md                      @{{TeamLead}}
/ARCHITECTURE.md                @{{TeamLead}} @{{Architect}}

# ---- Golden rules and core beliefs ----
/docs/design-docs/core-beliefs.md   @{{Architect}}

# ---- Domain-paired ownership: code dir + its design docs share an owner ----
# INSTRUCTION: one block per domain area. Example:
/src/{{ProjectName}}.Domain/Orders/          @{{OrdersOwner}}
/src/{{ProjectName}}.Application/Orders/     @{{OrdersOwner}}
/docs/design-docs/orders*.md                 @{{OrdersOwner}}
/docs/product-specs/orders*.md               @{{OrdersOwner}} @{{ProductOwner}}

# ---- Fallbacks ----
/docs/design-docs/              @{{Architect}}
/docs/product-specs/            @{{ProductOwner}}
/docs/exec-plans/               @{{TeamLead}}
