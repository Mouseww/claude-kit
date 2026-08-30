// Unit tests for the PATH probe in rtk-rewrite.mjs.
//
// These exist because of a real regression: the probe was called with the
// name "rtk.exe" on win32 while the function itself appends PATHEXT, so it
// searched for "rtk.exe.EXE" and never matched a real install. Every
// black-box test still passed, because "binary not found" and "binary found
// but broken" both fail open to empty stdout -- the bug was indistinguishable
// from correct behavior from the outside. Hence: test the probe directly.
//
// `platform` and `env` are injected rather than read from the process, so the
// win32 cases run identically on ubuntu-latest and windows-latest in CI.
// PATHEXT is spelled lowercase in these fixtures on purpose: real Windows
// PATHEXT is uppercase and Windows filesystems are case-insensitive, but
// ubuntu is not, so a lowercase fixture is the only spelling that exercises
// the same code path deterministically on both runners.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findOnPath } from '../scripts/rtk-rewrite.mjs';

function tempDirContaining(...filenames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-probe-'));
  for (const name of filenames) {
    fs.writeFileSync(path.join(dir, name), '');
  }
  return dir;
}

test('on win32 a binary saved as rtk.exe is found when probing for the bare name rtk', () => {
  const dir = tempDirContaining('rtk.exe');
  const found = findOnPath('rtk', { PATH: dir, PATHEXT: '.com;.exe;.bat;.cmd' }, 'win32');
  assert.equal(found, path.join(dir, 'rtk.exe'));
});

test('the call site probes the bare name, since appending PATHEXT to "rtk.exe" is what broke it', () => {
  // The probe is now tolerant of both spellings (the empty extension is tried
  // first on win32), so this cannot be caught behaviorally any more. Assert on
  // the call site directly instead: that is the thing that actually regressed,
  // and a wrong name there is invisible from the outside because a failed
  // probe and a missing binary produce identical output.
  const src = fs.readFileSync(new URL('../scripts/rtk-rewrite.mjs', import.meta.url), 'utf8');
  assert.match(src, /findOnPath\(\s*'rtk'\s*\)/, 'call site must probe the bare name "rtk"');
  assert.doesNotMatch(
    src,
    /findOnPath\(\s*'rtk\.exe'/,
    'probing for "rtk.exe" relies on the empty-extension fallback and misreads on any PATHEXT change'
  );
});

test('on win32 an extensionless rtk on PATH is still found, since the empty extension is tried first', () => {
  const dir = tempDirContaining('rtk');
  const found = findOnPath('rtk', { PATH: dir, PATHEXT: '.com;.exe' }, 'win32');
  assert.equal(found, path.join(dir, 'rtk'));
});

test('on posix only the bare name is probed, so a stray rtk.exe is not mistaken for the binary', () => {
  const dir = tempDirContaining('rtk.exe');
  const found = findOnPath('rtk', { PATH: dir }, 'linux');
  assert.equal(found, null);
});

test('on posix an executable named rtk is found', () => {
  const dir = tempDirContaining('rtk');
  const found = findOnPath('rtk', { PATH: dir }, 'linux');
  assert.equal(found, path.join(dir, 'rtk'));
});

test('an empty or missing PATH yields null instead of throwing, so the hook still fails open', () => {
  assert.equal(findOnPath('rtk', {}, 'linux'), null);
  assert.equal(findOnPath('rtk', { PATH: '' }, 'win32'), null);
});

test('a directory named rtk is not mistaken for the binary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rtk-probe-'));
  fs.mkdirSync(path.join(dir, 'rtk'));
  assert.equal(findOnPath('rtk', { PATH: dir }, 'linux'), null);
});

test('the first PATH entry containing a match wins, matching real shell lookup order', () => {
  const first = tempDirContaining('rtk');
  const second = tempDirContaining('rtk');
  const found = findOnPath('rtk', { PATH: [first, second].join(path.delimiter) }, 'linux');
  assert.equal(found, path.join(first, 'rtk'));
});
