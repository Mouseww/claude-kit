# Daily auto-update check for claude-kit plugins

## Purpose

Machines with claude-kit installed should automatically check for new plugin
versions on the first Claude Code use each day, and upgrade if available.

## Scope

- Only plugins installed from the claude-kit marketplace
- Lives in the `claude-kit-meta` plugin (marketplace-level concern)
- Cross-platform (macOS, Linux, Windows) -- Node.js only, no shell scripts

## Trigger mechanism

A `UserPromptSubmit` hook fires on every user message. The hook script
checks a date-stamped flag file and exits immediately (<1ms) if today's
check has already run.

If `UserPromptSubmit` is not honoured by the Claude Code version, the hook
is silently ignored -- no breakage. Future fallback: switch to `PreToolUse`
on a high-frequency tool (one-line change in `hooks.json`).

## Files

```
plugins/claude-kit-meta/
  hooks/hooks.json                   # register UserPromptSubmit hook
  scripts/check-daily-update.mjs     # core logic
```

Flag file: `~/.claude/claude-kit-update-check.json`

```json
{
  "lastCheck": "2026-08-05",
  "lastCommit": "abc123def456..."
}
```

## Hook registration

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/check-daily-update.mjs\""
          }
        ]
      }
    ]
  }
}
```

## Script flow

1. Read stdin (JSON event from Claude Code)
2. Read flag file `~/.claude/claude-kit-update-check.json`
   - If `lastCheck` equals today's date: exit 0, no output
3. Resolve the marketplace git URL from `~/.claude/plugins/` directory
   structure (not hardcoded)
4. Run `git ls-remote <url> HEAD` to get the remote HEAD commit hash
   - If it equals `lastCommit`: update `lastCheck` to today, exit 0
5. Run `claude plugin marketplace update claude-kit`
6. Scan `~/.claude/plugins/cache/claude-kit/` to find installed plugin names
7. For each installed plugin: `claude plugin update <name>@claude-kit`
8. For plugins that ship a `claude-md-block.md`: run
   `node <plugin-root>/scripts/sync-claude-md.mjs` to refresh the resident
   block in `~/.claude/CLAUDE.md`
9. Update flag file with today's date and new commit hash
10. Write to stdout:
    ```json
    {
      "additionalContext": "claude-kit plugins updated. Restart session for hook changes to take effect."
    }
    ```

## Error handling

- All subprocess calls use `execFileSync` with a 10-second timeout
- Any exception is caught and results in a silent exit (exit 0, no output)
- Update failure notifies via `additionalContext`: "update check failed,
  suggest manual: claude plugin marketplace update claude-kit"
- The hook never blocks the user's prompt (no `permissionDecision`)

## Marketplace URL resolution

The script does not hardcode a git URL. It reads the marketplace
configuration from Claude Code's plugin cache directory to find the
registered URL for the `claude-kit` marketplace. If it cannot be resolved,
the check is skipped silently.

## Constraints

- Node.js only -- no `.sh`, `.ps1`, or external tools beyond `git` and
  `claude` CLI (both expected to be on PATH)
- Flag file is user-level (`~/.claude/`), persists across sessions
- Immutable data: flag file is always written as a new object, never mutated
- 10-second timeout on all subprocesses prevents hanging
- No network call on repeat checks within the same day
