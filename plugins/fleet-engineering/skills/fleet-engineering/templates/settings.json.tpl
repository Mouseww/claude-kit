{
  "$comment": "Shared team Claude Code settings: commit as {repo}/.claude/settings.json. Personal overrides go in settings.local.json (gitignored). The hook below mechanically blocks hand-edits to GENERATED docs files; the self-healing message tells the agent to run docs_lint.py --fix instead.",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python .claude/hooks/block_generated_docs.py"
          }
        ]
      }
    ]
  }
}
