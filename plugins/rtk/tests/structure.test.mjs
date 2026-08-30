// Structural checks for the rtk pack. This pack wraps an external binary
// (rtk) that is not installed in CI, so these tests assert shape only:
// plugin.json/marketplace consistency, the hook declaration, and frontmatter.
// They never invoke rtk. Behavioral tests for the wrapper's fail-open
// guarantees live in rewrite.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(HERE, '..');
const ROOT = path.join(PACK, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('---'), `${file} has no frontmatter`);
  const end = text.indexOf('\n---', 3);
  const block = text.slice(text.indexOf('\n', 3) + 1, end + 1);
  const out = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function preToolUseHooks() {
  const hooks = readJson(path.join(PACK, 'hooks', 'hooks.json'));
  assert.ok(hooks.hooks && Array.isArray(hooks.hooks.PreToolUse), 'missing PreToolUse array');
  return hooks.hooks.PreToolUse;
}

test('plugin.json name equals the directory name', () => {
  const plugin = readJson(path.join(PACK, '.claude-plugin', 'plugin.json'));
  assert.equal(plugin.name, path.basename(PACK));
  assert.equal(plugin.name, 'rtk');
});

test('plugin.json is disabled by default, since it depends on a binary CI does not have', () => {
  const plugin = readJson(path.join(PACK, '.claude-plugin', 'plugin.json'));
  assert.equal(plugin.defaultEnabled, false);
});

test('the hook matches Bash only: rtk rewrite rules assume POSIX syntax and would corrupt PowerShell', () => {
  for (const group of preToolUseHooks()) {
    assert.equal(group.matcher, 'Bash', 'matcher must be exactly Bash');
    assert.ok(!/PowerShell/i.test(group.matcher), 'PowerShell must never be matched');
  }
});

test('the pack registers exactly one PreToolUse group, so a command cannot be rewritten twice', () => {
  assert.equal(preToolUseHooks().length, 1);
});

test('the hook entry point is a node .mjs script, not a shell script validate.mjs would reject', () => {
  for (const group of preToolUseHooks()) {
    for (const h of group.hooks) {
      assert.equal(h.type, 'command');
      assert.ok(/\.mjs\b/.test(h.command), `hook command is not a .mjs entry point: ${h.command}`);
      assert.ok(!/\.(sh|ps1|bat|cmd)\b/.test(h.command), `hook command invokes a shell script: ${h.command}`);
    }
  }
});

test('the hook references a wrapper file that actually exists, since a dangling path fails silently on every Bash call', () => {
  for (const group of preToolUseHooks()) {
    for (const h of group.hooks) {
      const matches = [...h.command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]*)/g)];
      assert.ok(matches.length > 0, 'hook command must reference ${CLAUDE_PLUGIN_ROOT}');
      for (const m of matches) {
        const target = path.resolve(PACK, '.' + m[1]);
        assert.ok(fs.existsSync(target), `hook references missing file: ${target}`);
      }
    }
  }
});

test('the hook budget stays under Claude Code default, and above the wrapper own 5s child timeout', () => {
  for (const group of preToolUseHooks()) {
    for (const h of group.hooks) {
      assert.ok(typeof h.timeout === 'number', 'hook must declare an explicit timeout');
      assert.ok(h.timeout > 5, 'hook timeout must exceed the wrapper 5s internal child timeout');
      assert.ok(h.timeout <= 15, 'a PreToolUse hook this long would stall every Bash call');
    }
  }
});

test('no .mcp.json ships with this pack: rtk is a hook, not an MCP server', () => {
  assert.equal(fs.existsSync(path.join(PACK, '.mcp.json')), false);
});

test('marketplace.json lists rtk with a matching name and a real source', () => {
  const marketplace = readJson(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = marketplace.plugins.find((p) => p.name === 'rtk');
  assert.ok(entry, 'rtk missing from marketplace.json');
  assert.equal(entry.source, './plugins/rtk');
  assert.ok(entry.description && entry.description.length > 0);
  assert.ok(fs.existsSync(path.resolve(ROOT, entry.source, '.claude-plugin', 'plugin.json')));
});

test('rtk skill exists with frontmatter name matching its directory', () => {
  const skillFile = path.join(PACK, 'skills', 'rtk', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile));
  const fm = frontmatter(skillFile);
  assert.equal(fm.name, 'rtk');
  assert.ok(fm.description && fm.description.length >= 40, 'description too short to guide relevance');
});

test('setup command exists with a description', () => {
  const file = path.join(PACK, 'commands', 'setup.md');
  assert.ok(fs.existsSync(file), 'missing commands/setup.md');
  const fm = frontmatter(file);
  assert.ok(fm.description && fm.description.length > 0, 'setup.md frontmatter missing description');
});

test('setup.md warns about the crates.io name collision, which silently installs the wrong tool', () => {
  const text = fs.readFileSync(path.join(PACK, 'commands', 'setup.md'), 'utf8');
  assert.ok(/cargo install rtk/.test(text), 'setup.md must name the exact wrong command');
  assert.ok(/crates\.io/.test(text), 'setup.md must explain where the collision lives');
});

test('the pack documents that it does not run rtk init -g, which would edit global CLAUDE.md', () => {
  const setup = fs.readFileSync(path.join(PACK, 'commands', 'setup.md'), 'utf8');
  const skill = fs.readFileSync(path.join(PACK, 'skills', 'rtk', 'SKILL.md'), 'utf8');
  for (const [name, text] of [['setup.md', setup], ['SKILL.md', skill]]) {
    assert.ok(/rtk init -g/.test(text), `${name} must mention the upstream installer it deliberately avoids`);
  }
});
