#!/usr/bin/env python3
"""PreToolUse hook: block Write/Edit on GENERATED docs files.

Commit as {repo}/.claude/hooks/block_generated_docs.py and wire it in
.claude/settings.json (see settings.json.tpl). Generated files are owned by
tools/docs_lint.py --fix; hand edits would be overwritten and break the CI
freshness check, so we fail fast with a self-healing message.

Hook contract: tool input arrives as JSON on stdin; exit code 2 blocks the
tool call and surfaces stderr to the agent.
"""
import json
import sys
from pathlib import PurePosixPath

GENERATED = (
    "docs/product-specs/index.md",
    "docs/design-docs/index.md",
    "docs/exec-plans/index.md",
    "docs/tech-debt/index.md",
    "docs/QUALITY_SCORE.md",
)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0  # malformed input: never block on our own bug

    file_path = (payload.get("tool_input") or {}).get("file_path", "")
    normalized = str(PurePosixPath(file_path.replace("\\", "/"))).lower()

    for gen in GENERATED:
        if normalized.endswith(gen.lower()):
            sys.stderr.write(
                "BLOCKED: '%s' is a GENERATED file (source of truth is document "
                "frontmatter). Do not edit it directly.\n"
                "How to fix: edit the leaf documents (specs/designs/plans/tech-debt/"
                "quality files), then run: python tools/docs_lint.py --fix\n" % gen
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
