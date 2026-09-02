#!/usr/bin/env node
// Fails when a plugin's runtime files changed but its version did not.
//
//   node scripts/check-version-bump.mjs --base <ref>
//
// CONTRIBUTING.md: the plugin version is the only update trigger. Change a
// hook and forget the bump and `claude plugin update` is a no-op, so the change
// reaches nobody and looks like it shipped. That failure is invisible in review,
// which is exactly what a machine check is for.
//
// Doc-only and test-only changes are exempt on purpose: they ship nothing to a
// user. Commit 7eb45ae changed a plugin README without a bump and was correct
// to do so.
//
// Every infrastructure problem is a SKIP, never a failure. This repo has two
// remotes with divergent history (bitbucket `main` and a cherry-picked public
// `github-public`), so an unresolvable base ref is normal and must not turn
// into a red build that teaches people to ignore it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A change to any of these ships behaviour to a user.
export const RUNTIME_DIRS = ['scripts', 'hooks', 'agents', 'skills', 'commands', '.claude-plugin'];
// ... plus these single files at the pack root.
const RUNTIME_FILES = ['.mcp.json', 'claude-md-block.md'];
// Anything under a pack that is not runtime. Listed for documentation; the
// check is positive (runtime only), so this is not load-bearing.
export const EXEMPT_PATTERNS = ['README.md', 'tests/'];

export function pluginOf(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 3 || parts[0] !== 'plugins') return null;
  return parts[1];
}

export function isRuntimePath(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 3 || parts[0] !== 'plugins') return false;
  const rest = parts.slice(2);
  if (rest.length === 1) return RUNTIME_FILES.includes(rest[0]);
  return RUNTIME_DIRS.includes(rest[0]);
}

export function decide(changedPaths, versionsBefore, versionsAfter) {
  const touched = new Set();
  for (const p of changedPaths) {
    if (!isRuntimePath(p)) continue;
    const name = pluginOf(p);
    if (name) touched.add(name);
  }
  const violations = [];
  const checked = [];
  for (const name of touched) {
    const before = versionsBefore[name];
    const after = versionsAfter[name];
    // A pack that did not exist before, or does not exist now, has no bump to
    // make. Added and deleted packs are both fine.
    if (before == null || after == null) continue;
    checked.push(name);
    if (before === after) {
      violations.push({
        plugin: name,
        reason: `runtime files changed but version stayed at ${after}`,
      });
    }
  }
  return { violations, checked };
}

// ---- I/O below this line ----------------------------------------------------

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function skip(why) {
  console.log(`SKIP: ${why}`);
  process.exit(0);
}

function versionsAt(ref) {
  const out = {};
  let names;
  try {
    names = fs
      .readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  // Union with whatever existed at the base ref, so a deleted pack is visible.
  try {
    const listed = git(['ls-tree', '--name-only', `${ref}:plugins`]).trim().split('\n');
    for (const n of listed) if (n) names.push(n.replace(/\/$/, ''));
  } catch {
    /* the base ref may not have a plugins directory at all */
  }
  for (const name of new Set(names)) {
    const file = `plugins/${name}/.claude-plugin/plugin.json`;
    try {
      const text = git(['show', `${ref}:${file}`]);
      const v = JSON.parse(text).version;
      if (v != null) out[name] = String(v);
    } catch {
      /* absent at this ref */
    }
  }
  return out;
}

function main() {
  const baseIdx = process.argv.indexOf('--base');
  if (baseIdx === -1 || !process.argv[baseIdx + 1]) {
    skip('no --base given; nothing to compare against');
  }
  const base = process.argv[baseIdx + 1];

  try {
    git(['rev-parse', '--verify', base]);
  } catch {
    skip(`base ref "${base}" is not present in this clone (shallow fetch, or a divergent branch)`);
  }

  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim();
  } catch {
    skip(`no common ancestor between "${base}" and HEAD; this branch has divergent history`);
  }
  if (!mergeBase) skip('empty merge-base');

  let changed;
  try {
    changed = git(['diff', '--name-only', `${mergeBase}..HEAD`]).trim();
  } catch {
    skip('could not compute the diff');
  }
  const changedPaths = changed ? changed.split('\n').filter(Boolean) : [];
  if (changedPaths.length === 0) skip('no files changed in the range');

  const { violations, checked } = decide(changedPaths, versionsAt(mergeBase), versionsAt('HEAD'));

  if (checked.length === 0) {
    console.log('OK: no plugin runtime files changed in this range');
    process.exit(0);
  }
  console.log(`checked: ${checked.sort().join(', ')}`);
  if (violations.length === 0) {
    console.log(`OK: every plugin with runtime changes was bumped`);
    process.exit(0);
  }
  for (const v of violations) {
    console.log(`  ERROR plugins/${v.plugin}: ${v.reason}`);
  }
  console.log('');
  console.log('The plugin version is the only update trigger: without a bump,');
  console.log('`claude plugin update` is a no-op and the change reaches nobody.');
  console.log('Bump the version in plugins/<name>/.claude-plugin/plugin.json.');
  process.exit(1);
}

// Guard so importing this module (as the test file does) does not also run
// main() and exit the process before the imported test() bodies execute.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
