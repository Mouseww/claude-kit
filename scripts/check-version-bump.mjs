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
// Every infrastructure problem is a SKIP, never a failure. This repo is mirrored
// across remotes whose histories diverge because commits are cherry-picked
// between them, so an unresolvable base ref is normal and must not turn into a
// red build that teaches people to ignore it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything under a plugin ships to a user EXCEPT the handful of paths
// below, which are documentation/test scaffolding that never reaches an
// installed copy. This is a deny-list on purpose: an allow-list silently
// treats any new top-level file or directory as non-runtime until someone
// remembers to add it here, which is exactly backwards for a check whose job
// is to catch a forgotten bump.
export function pluginOf(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 3 || parts[0] !== 'plugins') return null;
  return parts[1];
}

export function isRuntimePath(relPath) {
  const parts = relPath.split('/');
  if (parts.length < 3 || parts[0] !== 'plugins') return false;
  const rest = parts.slice(2);
  const top = rest[0];

  // Whole subtrees that ship nothing to an installed copy, at any depth.
  if (top === 'tests' || top === 'docs') return false;

  if (rest.length === 1) {
    // A single file directly at the plugin root.
    if (/^readme\.md$/i.test(top)) return false;
    if (top === 'CHANGELOG.md') return false;
    if (/\.md$/i.test(top) && top !== 'claude-md-block.md') return false;
    return true;
  }

  // Anything nested (skills/, agents/, commands/, hooks/, scripts/,
  // .claude-plugin/, or anything else) ships.
  return true;
}

// Compares two `x.y.z` version strings numerically, part by part. Both sides
// are already validated as bare x.y.z by validate.mjs, so this stays a plain
// numeric compare rather than a full semver parser. Returns negative, zero,
// or positive the way Array.prototype.sort expects.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function decide(changedPaths, versionsBefore, versionsAfter, renames = []) {
  const touched = new Set();
  for (const p of changedPaths) {
    if (!isRuntimePath(p)) continue;
    const name = pluginOf(p);
    if (name) touched.add(name);
  }
  const violations = [];
  const checked = [];

  // A plugin renamed mid-diff (plugins/foo -> plugins/bar) makes foo
  // "disappear" and bar "appear" in the same range. Treated as an ordinary
  // add + delete, both sides pass with no bump required at all -- exactly the
  // no-op `claude plugin update` case this gate exists to catch, laundered
  // through a rename. Caught two ways: explicitly, via `renames` (git's own
  // rename detection, resolved to plugin names by main()); implicitly,
  // whenever something appeared and something else disappeared in the same
  // diff, even if git did not call it a rename.
  const beforeSet = new Set(Object.keys(versionsBefore));
  const afterSet = new Set(Object.keys(versionsAfter));
  const appeared = [...afterSet].filter((n) => !beforeSet.has(n));
  const disappeared = [...beforeSet].filter((n) => !afterSet.has(n));

  const explicitRenames = renames.filter((r) => r.from !== r.to);
  // Only pair implicitly when the range has exactly one disappeared plugin
  // and exactly one appeared plugin -- the unambiguous single-rename case.
  // With more than one on either side there's no way to tell "A renamed to
  // B, C is unrelated" from "A renamed to C, B is unrelated" without git's
  // own rename detection, so those are left as ordinary deletes (no bump)
  // and ordinary adds (no bump), not silently paired.
  const suspectedRename = disappeared.length === 1 && appeared.length === 1;

  if (explicitRenames.length > 0 || suspectedRename) {
    // Prefer git's own rename pairing when we have it. Otherwise pair the
    // sole disappeared/appeared name -- safe because suspectedRename only
    // fires for exactly one of each.
    const pairs =
      explicitRenames.length > 0
        ? explicitRenames
        : disappeared.map((from, i) => ({ from, to: appeared[i] })).filter((p) => p.to);

    for (const { from, to } of pairs) {
      const before = versionsBefore[from];
      const after = versionsAfter[to];
      checked.push(to);
      touched.delete(to);
      touched.delete(from);
      if (before == null || after == null || compareVersions(after, before) <= 0) {
        violations.push({
          plugin: to,
          reason: `looks like a rename of "${from}" (was ${before ?? 'unknown'}); a renamed plugin must bump its version above the old one's, not carry it over unchanged`,
        });
      }
    }
  }

  for (const name of touched) {
    const before = versionsBefore[name];
    const after = versionsAfter[name];
    // A pack that did not exist before, or does not exist now, has no bump to
    // make. Added and deleted packs are both fine (unless the rename check
    // above already claimed one side of it, in which case it was removed
    // from `touched` and never reaches here).
    if (before == null || after == null) continue;
    checked.push(name);
    // Strictly greater, not merely different: an equal version is unbumped,
    // and a downgrade (e.g. a merge conflict resolved toward the older side)
    // is exactly the no-op `claude plugin update` case this gate exists to
    // catch, not a pass.
    if (compareVersions(after, before) <= 0) {
      violations.push({
        plugin: name,
        reason:
          after === before
            ? `runtime files changed but version stayed at ${after}`
            : `runtime files changed but version went backwards, from ${before} to ${after}`,
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

// git's own rename detection, narrowed to renames that cross a plugin
// boundary (plugins/foo/... -> plugins/bar/...). Best-effort: any failure
// here still leaves the implicit appeared+disappeared heuristic in decide()
// to catch the common case.
function renamedPluginPairs(ref) {
  const seen = new Set();
  const out = [];
  let text;
  try {
    text = git(['diff', '--find-renames', '--name-status', `${ref}..HEAD`]);
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('R')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const fromPlugin = pluginOf(parts[1]);
    const toPlugin = pluginOf(parts[2]);
    if (!fromPlugin || !toPlugin || fromPlugin === toPlugin) continue;
    const key = `${fromPlugin}->${toPlugin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: fromPlugin, to: toPlugin });
  }
  return out;
}

function main() {
  const baseIdx = process.argv.indexOf('--base');
  if (baseIdx === -1) {
    skip('no --base given; nothing to compare against');
  }
  // An empty string is a legitimate value here, not a missing flag: some CI
  // systems pass "" for the PR base on a plain branch push. It
  // now falls through to the same origin/main fallback as an unresolvable
  // SHA, rather than skipping immediately.
  let base = process.argv[baseIdx + 1] || '';

  // On the first push of a new branch there is no prior commit to diff
  // against: CI hands this script the all-zero SHA (GitHub) or an unset var
  // (other CI, handled by the caller passing ''). Either way `base` fails to
  // resolve, and the fallback is the best available substitute: where this
  // branch forked from origin/main.
  const looksResolvable = base && !/^0+$/.test(base.trim());
  let resolved = false;
  if (looksResolvable) {
    try {
      git(['rev-parse', '--verify', base]);
      resolved = true;
    } catch {
      resolved = false;
    }
  }

  if (!resolved) {
    const why = !base
      ? 'no base ref was given (e.g. an unset destination commit on a plain branch push)'
      : !looksResolvable
        ? `base ref "${base}" is the all-zero SHA (first push on a new branch)`
        : `base ref "${base}" is not present in this clone (shallow fetch, or a divergent branch)`;
    try {
      const fallback = git(['merge-base', 'HEAD', 'origin/main']).trim();
      if (!fallback) throw new Error('empty merge-base');
      console.log(`${why}; falling back to merge-base(HEAD, origin/main)`);
      base = fallback;
      resolved = true;
    } catch (e) {
      skip(`${why}, and the origin/main fallback also failed (${String(e.message || e).split('\n')[0]})`);
    }
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

  const renames = renamedPluginPairs(mergeBase);
  const { violations, checked } = decide(changedPaths, versionsAt(mergeBase), versionsAt('HEAD'), renames);

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
//
// Compares two normalized native paths rather than a file:// URL, which
// avoids a drive-letter-case mismatch on Windows that the URL form does not
// normalize away.
const isMain = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isMain) main();
