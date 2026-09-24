// Tests for scripts/sync-claude-md.mjs.
//
//   node --test "tests/*.test.mjs"
//
// This script edits a user's CLAUDE.md, including possibly their global one, so
// the interesting cases are all about what it must NOT disturb: content outside
// the markers, line endings, a BOM, and the block's position in the file.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'scripts', 'sync-claude-md.mjs');
const BLOCK = fs.readFileSync(path.join(REPO, 'plugins', 'dev-agents', 'claude-md-block.md'), 'utf8');

// The block body, exactly as the script derives it from the file.
const BODY = BLOCK.slice(BLOCK.indexOf('\n---', 3))
  .replace(/^\n---[^\n]*\n/, '')
  .replace(/^\n+/, '')
  .replace(/\s+$/, '');

const BEGIN = '<!-- BEGIN dev-agents (managed) -->';
const END = '<!-- END dev-agents (managed) -->';

let dir;
let target;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-sync-'));
  target = path.join(dir, 'CLAUDE.md');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(extra = []) {
  const p = spawnSync(
    process.execPath,
    [SCRIPT, '--plugin', 'dev-agents', '--target', target, ...extra],
    { encoding: 'utf8', cwd: REPO }
  );
  return { status: p.status, out: p.stdout || '', err: p.stderr || '' };
}

const read = () => fs.readFileSync(target, 'utf8');

test('creates the file when none exists', () => {
  const r = run();
  assert.equal(r.status, 0, r.err);
  const t = read();
  assert.ok(t.startsWith(BEGIN));
  assert.ok(t.trimEnd().endsWith(END));
  assert.match(t, /The write handoff, the one most often missed/);
});

test('is idempotent', () => {
  run();
  const first = read();
  const r = run();
  assert.match(r.out, /No change needed/);
  assert.equal(read(), first);
});

test('appends without touching existing content', () => {
  const existing = '# My rules\n\nAlways respond in Chinese.\n\n## Style\n\nNo emdash.\n';
  fs.writeFileSync(target, existing);
  run();
  const t = read();
  assert.ok(t.startsWith(existing.trimEnd()), 'existing content must be preserved verbatim at the top');
  assert.ok(t.includes(BEGIN) && t.includes(END));
});

test('updates in place, preserving position and surrounding content', () => {
  fs.writeFileSync(target, `# Top\n\n${BEGIN}\nstale content\n${END}\n\n# Bottom\n`);
  run();
  const t = read();
  assert.ok(t.startsWith('# Top\n'), 'content above the block must stay above it');
  assert.ok(t.trimEnd().endsWith('# Bottom'), 'content below the block must stay below it');
  assert.equal(t.includes('stale content'), false);
  assert.match(t, /Delegate by default|Delegate to subagents by default/);
});

test('replaces a superseded block in place and does not leave two', () => {
  const legacyBegin = '<!-- BEGIN context-offload (managed) -->';
  const legacyEnd = '<!-- END context-offload (managed) -->';
  fs.writeFileSync(target, `# Top\n\n${legacyBegin}\nold policy\n${legacyEnd}\n\n# Bottom\n`);
  const r = run();
  assert.match(r.out, /replaced the superseded "context-offload" block/);
  const t = read();
  assert.equal(t.includes(legacyBegin), false, 'legacy marker must be gone');
  assert.equal(t.includes('old policy'), false);
  assert.equal((t.match(/Delegate to subagents by default/g) || []).length, 1, 'exactly one block');
  assert.ok(t.startsWith('# Top\n') && t.trimEnd().endsWith('# Bottom'));
});

test('collapses a file that somehow has both the new and the legacy block', () => {
  fs.writeFileSync(
    target,
    `${BEGIN}\ncurrent\n${END}\n\n<!-- BEGIN context-offload (managed) -->\nold\n<!-- END context-offload (managed) -->\n`
  );
  const r = run();
  assert.match(r.out, /removed the superseded "context-offload" block/);
  const t = read();
  assert.equal(t.includes('context-offload (managed)'), false);
  assert.equal((t.match(/BEGIN dev-agents \(managed\)/g) || []).length, 1);
});

test('removes duplicate blocks of its own name', () => {
  fs.writeFileSync(target, `${BEGIN}\na\n${END}\n\n${BEGIN}\nb\n${END}\n`);
  const r = run();
  assert.match(r.out, /removed a duplicate/);
  assert.equal((read().match(/BEGIN dev-agents \(managed\)/g) || []).length, 1);
});

test('preserves CRLF line endings', () => {
  fs.writeFileSync(target, '# Top\r\n\r\nkeep me\r\n');
  run();
  const raw = fs.readFileSync(target, 'latin1');
  assert.equal(/(?<!\r)\n/.test(raw), false, 'no bare LF may be introduced into a CRLF file');
  assert.ok(raw.includes('keep me\r\n'));
});

test('preserves LF line endings', () => {
  fs.writeFileSync(target, '# Top\n\nkeep me\n');
  run();
  assert.equal(fs.readFileSync(target, 'latin1').includes('\r\n'), false);
});

test('preserves a BOM', () => {
  fs.writeFileSync(target, '﻿# Top\n\nkeep me\n');
  run();
  assert.ok(read().startsWith('﻿'), 'BOM must survive');
});

test('preserves a missing trailing newline', () => {
  fs.writeFileSync(target, '# Top\n\nno trailing newline');
  run();
  assert.equal(/\n$/.test(read()), false);
});

test('refuses to write when a BEGIN is never closed', () => {
  const broken = `# Top\n\n${BEGIN}\nhalf a block\n`;
  fs.writeFileSync(target, broken);
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.err, /never closed/);
  assert.equal(read(), broken, 'the file must be left exactly as it was');
});

test('refuses to write on an END with no BEGIN', () => {
  const broken = `# Top\n\n${END}\n`;
  fs.writeFileSync(target, broken);
  const r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.err, /no matching BEGIN/);
  assert.equal(read(), broken);
});

test('dry run writes nothing and leaves no backup', () => {
  fs.writeFileSync(target, '# Top\n');
  const r = run(['--dry-run']);
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Dry run: nothing was written/);
  assert.equal(read(), '# Top\n');
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.endsWith('.bak')),
    []
  );
});

test('writes a backup before overwriting', () => {
  fs.writeFileSync(target, '# Top\n');
  run();
  const backups = fs.readdirSync(dir).filter((f) => f.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '# Top\n');
});

test('--remove strips the block and the legacy block, keeping everything else', () => {
  fs.writeFileSync(
    target,
    `# Top\n\n${BEGIN}\nx\n${END}\n\n<!-- BEGIN context-offload (managed) -->\ny\n<!-- END context-offload (managed) -->\n\n# Bottom\n`
  );
  const r = run(['--remove']);
  assert.equal(r.status, 0, r.err);
  const t = read();
  assert.equal(t.includes('managed'), false);
  assert.ok(t.includes('# Top') && t.includes('# Bottom'));
});

test('--remove on a file with no block is a no-op', () => {
  fs.writeFileSync(target, '# Top\n');
  const r = run(['--remove']);
  assert.equal(r.status, 0);
  assert.match(r.out, /nothing to remove/);
  assert.equal(read(), '# Top\n');
});

test('tolerates whitespace variation in the markers', () => {
  fs.writeFileSync(target, `# Top\n\n<!--  BEGIN   dev-agents  (managed)  -->\nx\n<!--  END   dev-agents  (managed)  -->\n`);
  const r = run();
  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /updated the "dev-agents" block in place/);
  assert.equal((read().match(/BEGIN dev-agents/g) || []).length, 1);
});

test('rejects an unknown plugin instead of writing anything', () => {
  const p = spawnSync(
    process.execPath,
    [SCRIPT, '--plugin', 'no-such-pack', '--target', target],
    { encoding: 'utf8', cwd: REPO }
  );
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /ships no claude-md-block\.md/);
  assert.equal(fs.existsSync(target), false);
});

// ---- installed-plugin layout (no --plugin; script and block ship side by side) ----

test('installed layout: running with no --plugin resolves the block next to the script', () => {
  const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-installed-'));
  try {
    fs.mkdirSync(path.join(installDir, 'scripts'));
    fs.copyFileSync(SCRIPT, path.join(installDir, 'scripts', 'sync-claude-md.mjs'));
    fs.writeFileSync(path.join(installDir, 'claude-md-block.md'), BLOCK);

    const p = spawnSync(
      process.execPath,
      [path.join(installDir, 'scripts', 'sync-claude-md.mjs'), '--target', target],
      { encoding: 'utf8', cwd: REPO }
    );
    assert.equal(p.status, 0, p.stderr);
    const t = read();
    assert.ok(t.startsWith(BEGIN));
    assert.ok(t.trimEnd().endsWith(END));
    assert.match(t, /The write handoff, the one most often missed/);
  } finally {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
});

// ---- --heal ---------------------------------------------------------------
//
// --heal is what the SessionStart hook runs. Targets are always
// ~/.claude/CLAUDE.md and <cwd>/CLAUDE.md, so these tests point HOME (and
// USERPROFILE, for os.homedir() on Windows) and cwd at temp directories and
// never touch the real ~/.claude.

let healHome;
let healCwd;
let healInstallDir;

beforeEach(() => {
  healHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-heal-home-'));
  healCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-heal-cwd-'));
  healInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-heal-plugin-'));
  fs.mkdirSync(path.join(healInstallDir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(healInstallDir, 'scripts', 'sync-claude-md.mjs'));
  fs.writeFileSync(path.join(healInstallDir, 'claude-md-block.md'), BLOCK);
});

afterEach(() => {
  fs.rmSync(healHome, { recursive: true, force: true });
  fs.rmSync(healCwd, { recursive: true, force: true });
  fs.rmSync(healInstallDir, { recursive: true, force: true });
});

function userClaudeMd() {
  return path.join(healHome, '.claude', 'CLAUDE.md');
}

function cwdClaudeMd() {
  return path.join(healCwd, 'CLAUDE.md');
}

function runHeal(extraEnv = {}) {
  const p = spawnSync(
    process.execPath,
    [path.join(healInstallDir, 'scripts', 'sync-claude-md.mjs'), '--heal'],
    {
      encoding: 'utf8',
      cwd: healCwd,
      env: { ...process.env, HOME: healHome, USERPROFILE: healHome, ...extraEnv },
    }
  );
  return { status: p.status, out: p.stdout || '', err: p.stderr || '' };
}

function parseHookOutput(out) {
  if (!out.trim()) return null;
  return JSON.parse(out);
}

test('--heal updates a stale block already present in the target', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  fs.writeFileSync(userClaudeMd(), `# Top\n\n${BEGIN}\nstale content\n${END}\n\n# Bottom\n`);

  const r = runHeal();
  assert.equal(r.status, 0, r.err);

  const t = fs.readFileSync(userClaudeMd(), 'utf8');
  assert.equal(t.includes('stale content'), false);
  assert.match(t, /Delegate by default|Delegate to subagents by default/);
  assert.ok(t.startsWith('# Top\n') && t.trimEnd().endsWith('# Bottom'));

  const backups = fs.readdirSync(path.dirname(userClaudeMd())).filter((f) => f.endsWith('.bak'));
  assert.equal(backups.length, 1);

  const hook = parseHookOutput(r.out);
  assert.ok(hook);
  assert.equal(hook.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(hook.hookSpecificOutput.additionalContext, /dev-agents: refreshed the managed block/);
  assert.match(hook.hookSpecificOutput.additionalContext, /takes effect in the next session/);
  assert.match(hook.hookSpecificOutput.additionalContext, /Backup:/);
});

test('--heal leaves a file without the marker untouched', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  const original = '# Top\n\nSome unrelated rules.\n';
  fs.writeFileSync(userClaudeMd(), original);

  const r = runHeal();
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.readFileSync(userClaudeMd(), 'utf8'), original);
  assert.equal(
    fs.readdirSync(path.dirname(userClaudeMd())).filter((f) => f.endsWith('.bak')).length,
    0
  );
  assert.equal(parseHookOutput(r.out), null);
});

test('--heal skips unbalanced markers silently', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  const broken = `# Top\n\n${BEGIN}\nhalf a block\n`;
  fs.writeFileSync(userClaudeMd(), broken);

  const r = runHeal();
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.readFileSync(userClaudeMd(), 'utf8'), broken, 'file must be left exactly as it was');
  assert.equal(parseHookOutput(r.out), null);
});

test('--heal replaces a superseded marker in an existing target', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  const legacyBegin = '<!-- BEGIN context-offload (managed) -->';
  const legacyEnd = '<!-- END context-offload (managed) -->';
  fs.writeFileSync(userClaudeMd(), `# Top\n\n${legacyBegin}\nold policy\n${legacyEnd}\n\n# Bottom\n`);

  const r = runHeal();
  assert.equal(r.status, 0, r.err);
  const t = fs.readFileSync(userClaudeMd(), 'utf8');
  assert.equal(t.includes(legacyBegin), false);
  assert.equal((t.match(/BEGIN dev-agents \(managed\)/g) || []).length, 1);

  const hook = parseHookOutput(r.out);
  assert.ok(hook);
  assert.match(hook.hookSpecificOutput.additionalContext, /dev-agents: refreshed/);
});

test('--heal never creates a file and never appends to one with no existing block', () => {
  // Neither target exists at all.
  const r = runHeal();
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.existsSync(userClaudeMd()), false);
  assert.equal(fs.existsSync(cwdClaudeMd()), false);
  assert.equal(parseHookOutput(r.out), null);
});

test('CLAUDE_KIT_NO_HEAL=1 opts out entirely', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  const stale = `# Top\n\n${BEGIN}\nstale content\n${END}\n`;
  fs.writeFileSync(userClaudeMd(), stale);

  const r = runHeal({ CLAUDE_KIT_NO_HEAL: '1' });
  assert.equal(r.status, 0, r.err);
  assert.equal(fs.readFileSync(userClaudeMd(), 'utf8'), stale);
  assert.equal(parseHookOutput(r.out), null);
});

test('--heal is idempotent: a second run prints nothing and changes nothing', () => {
  fs.mkdirSync(path.dirname(userClaudeMd()), { recursive: true });
  fs.writeFileSync(userClaudeMd(), `# Top\n\n${BEGIN}\nstale content\n${END}\n`);

  const first = runHeal();
  assert.equal(first.status, 0, first.err);
  assert.ok(parseHookOutput(first.out));
  const afterFirst = fs.readFileSync(userClaudeMd(), 'utf8');

  const second = runHeal();
  assert.equal(second.status, 0, second.err);
  assert.equal(parseHookOutput(second.out), null);
  assert.equal(fs.readFileSync(userClaudeMd(), 'utf8'), afterFirst);
});

// ---- the three shipped copies must never drift -----------------------------

test('the three shipped copies of sync-claude-md.mjs are byte-identical', () => {
  const normalize = (s) => s.replace(/\r\n/g, '\n');
  const reference = normalize(fs.readFileSync(SCRIPT, 'utf8'));
  const copies = [
    path.join(REPO, 'plugins', 'dev-agents', 'scripts', 'sync-claude-md.mjs'),
    path.join(REPO, 'plugins', 'concrete-answers', 'scripts', 'sync-claude-md.mjs'),
  ];
  for (const copy of copies) {
    assert.equal(
      normalize(fs.readFileSync(copy, 'utf8')),
      reference,
      `${path.relative(REPO, copy)} differs from scripts/sync-claude-md.mjs; copy it verbatim`
    );
  }
});

test('the shipped block stays small enough to sit in context every turn', () => {
  // It is resident on every turn, so growth here is a real recurring cost.
  // Raise this ceiling deliberately, not by accident.
  //
  // Raised 3500 -> 4100 on 2026-08-20 to buy the "then check what came back"
  // rule: the pack warned before a dispatch and said nothing about the result,
  // so an interrupted or blocked subagent got treated as a finished one.
  assert.ok(BODY.length < 4100, `block is ${BODY.length} chars; keep it under 4100`);
});
