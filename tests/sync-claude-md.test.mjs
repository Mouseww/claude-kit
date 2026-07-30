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

test('the shipped block stays small enough to sit in context every turn', () => {
  // It is resident on every turn, so growth here is a real recurring cost.
  // Raise this ceiling deliberately, not by accident.
  assert.ok(BODY.length < 3500, `block is ${BODY.length} chars; keep it under 3500`);
});
