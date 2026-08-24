// The block is resident on every turn, so its size is a recurring cost paid on
// every request. This test is the deliberate ceiling: raising it is allowed, but
// it has to be a decision somebody made, not drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(HERE, '..');
const RAW = fs.readFileSync(path.join(PACK, 'claude-md-block.md'), 'utf8');
const BODY = RAW.replace(/^---[\s\S]*?---\r?\n/, '');

test('block carries the frontmatter the sync script needs', () => {
  assert.match(RAW, /^---\r?\n/, 'starts with frontmatter');
  assert.match(RAW, /^markers:\s*concrete-answers\s*$/m, 'markers matches the pack name');
});

test('block stays inside its resident-cost ceiling', () => {
  assert.ok(BODY.length < 2000, `block is ${BODY.length} chars; keep it under 2000`);
});

test('block states the rules it is there to enforce', () => {
  for (const anchor of [
    'Name the real thing',
    'substitution, not an addition',
    'No stand-in labels',
    'No filler abstractions',
  ]) {
    assert.ok(BODY.includes(anchor), `missing rule heading: ${anchor}`);
  }
});

// The samples are the enforcement mechanism: a model does not recognize its own
// filler from an abstract prohibition, it recognizes it from seeing the phrase
// written out. Trimming the block is fine; trimming these is not.
test('block keeps the literal samples each rule fires on', () => {
  for (const sample of ['$1.1', 'improved robustness', '重构了相关模块', 'require-task-plan']) {
    assert.ok(BODY.includes(sample), `missing sample: ${sample}`);
  }
});

test('skill and command exist, so the block can point at them and be installed', () => {
  assert.ok(fs.existsSync(path.join(PACK, 'skills', 'concrete-answers', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(PACK, 'commands', 'sync-claude-md.md')));
});
