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

// Raised from 2000 to 3500 on 2026-08-29: the pack absorbed the writing-style
// half (four rules became twelve), a deliberate decision, not drift. Cost is
// roughly 475 extra tokens per request, paid on every turn the block is resident.
test('block stays inside its resident-cost ceiling', () => {
  assert.ok(BODY.length < 3500, `block is ${BODY.length} chars; keep it under 3500`);
});

test('block states the rules it is there to enforce', () => {
  for (const anchor of [
    'Name the real thing',
    'substitution, not an addition',
    'No stand-in labels',
    'No filler abstractions',
    'Would you say this sentence out loud',
    'Conclusion first, and bad news first',
    'Verbs, not stacks of nouns',
    'measured or estimated',
    'Recommend, do not lay out a menu',
    'Length matches information',
    'Banned outright',
  ]) {
    assert.ok(BODY.includes(anchor), `missing rule heading: ${anchor}`);
  }
});

// The samples are the enforcement mechanism: a model does not recognize its own
// filler from an abstract prohibition, it recognizes it from seeing the phrase
// written out. Trimming the block is fine; trimming these is not.
test('block keeps the literal samples each rule fires on', () => {
  for (const sample of [
    '$1.1',
    'improved robustness',
    '重构了相关模块',
    'require-task-plan',
    '身份桥',
    '好的，我来分析一下',
    '强大的',
    '建议 A',
    '如果 X，那么 Y 要重做',
  ]) {
    assert.ok(BODY.includes(sample), `missing sample: ${sample}`);
  }
});

// The block bans em dashes and emoji outright; a block that breaks its own ban
// on either is the bug this test exists to catch.
test('block does not itself contain an em dash or an emoji', () => {
  assert.ok(!BODY.includes('—'), 'block contains an em dash');
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  assert.ok(!emojiPattern.test(BODY), 'block contains an emoji');
});

test('skill and command exist, so the block can point at them and be installed', () => {
  assert.ok(fs.existsSync(path.join(PACK, 'skills', 'concrete-answers', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(PACK, 'commands', 'sync-claude-md.md')));
});
