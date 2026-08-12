// Tests for scripts/resolve-command.mjs.
//
//   node --test "plugins/**/tests/*.test.mjs"
//
// This module is pure (no process side effects), so it is imported directly
// rather than exercised via spawnSync, like marketplace-source.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickExecutable, needsShell } from '../scripts/resolve-command.mjs';

// -----------------------------------------------------------------------
// pickExecutable
// -----------------------------------------------------------------------

test('pickExecutable: real `where claude` output picks the .cmd wrapper over the extensionless one', () => {
  const whereOutput = 'C:\\nvm4w\\nodejs\\claude\r\nC:\\nvm4w\\nodejs\\claude.cmd\r\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\nvm4w\\nodejs\\claude.cmd');
});

test('pickExecutable: .exe outranks .cmd when both are present', () => {
  const whereOutput = 'C:\\tools\\claude.cmd\nC:\\tools\\claude.exe\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\tools\\claude.exe');
});

test('pickExecutable: .cmd outranks .bat when both are present', () => {
  const whereOutput = 'C:\\tools\\claude.bat\nC:\\tools\\claude.cmd\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\tools\\claude.cmd');
});

test('pickExecutable: falls back to the extensionless candidate when nothing else is available', () => {
  const whereOutput = 'C:\\nvm4w\\nodejs\\claude\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\nvm4w\\nodejs\\claude');
});

test('pickExecutable: empty string returns null', () => {
  assert.equal(pickExecutable(''), null);
});

test('pickExecutable: whitespace-only output returns null', () => {
  assert.equal(pickExecutable('   \r\n  \n\t\n'), null);
});

test('pickExecutable: handles \\r\\n line endings', () => {
  const whereOutput = 'C:\\a\\claude\r\nC:\\a\\claude.cmd\r\nC:\\a\\claude.exe\r\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\a\\claude.exe');
});

test('pickExecutable: extension matching is case-insensitive', () => {
  const whereOutput = 'C:\\a\\CLAUDE\nC:\\a\\CLAUDE.CMD\n';
  assert.equal(pickExecutable(whereOutput), 'C:\\a\\CLAUDE.CMD');
});

test('pickExecutable: null-ish input returns null', () => {
  assert.equal(pickExecutable(null), null);
  assert.equal(pickExecutable(undefined), null);
});

// -----------------------------------------------------------------------
// needsShell
// -----------------------------------------------------------------------

test('needsShell: true for .cmd', () => {
  assert.equal(needsShell('C:\\a\\claude.cmd'), true);
});

test('needsShell: true for .bat', () => {
  assert.equal(needsShell('C:\\a\\claude.bat'), true);
});

test('needsShell: true for .cmd regardless of case', () => {
  assert.equal(needsShell('C:\\a\\CLAUDE.CMD'), true);
});

test('needsShell: false for .exe', () => {
  assert.equal(needsShell('C:\\a\\claude.exe'), false);
});

test('needsShell: false for an extensionless path', () => {
  assert.equal(needsShell('C:\\a\\claude'), false);
});

test('needsShell: false for other extensions like .mjs', () => {
  assert.equal(needsShell('C:\\a\\script.mjs'), false);
});
