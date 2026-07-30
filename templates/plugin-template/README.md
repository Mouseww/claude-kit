# plugin-template

Skeleton for a new claude-kit capability pack. Copy the whole directory:

```bash
cp -r templates/plugin-template plugins/<your-plugin-name>
```

Then, in order:

1. **`.claude-plugin/plugin.json`** — set `name` to exactly the directory name.
   Write a real `description`; it is what a human reads in `/plugin`.
2. **Delete what you do not use.** An empty `agents/`, `commands/`, `skills/` or
   `hooks/` directory is noise. If there are no hooks, also drop the `"hooks"`
   key from `plugin.json`, or the plugin will fail to load.
3. **Register it** in `.claude-plugin/marketplace.json` with
   `"source": "./plugins/<your-plugin-name>"`.
4. **Validate**: `node scripts/validate.mjs`.

The example files below are all placeholders. Replace or delete every one of
them; do not ship a pack containing `REPLACE-ME`.

| Path | Purpose |
|---|---|
| `skills/example-skill/SKILL.md` | Reference material the model loads on demand |
| `agents/example-agent.md` | A subagent with its own context and model tier |
| `commands/example-command.md` | A `/plugin-name:command` slash command |
| `hooks/hooks.json` | Event wiring; entry points must be `node ... .mjs` |
| `scripts/example-hook.mjs` | The hook implementation |

See `CONTRIBUTING.md` at the repository root for the rules the validator enforces.
