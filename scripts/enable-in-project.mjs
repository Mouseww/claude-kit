#!/usr/bin/env node
// Enable claude-kit plugins for a specific project by writing that project's
// .claude/settings.json. Requires only node.
//
//   node scripts/enable-in-project.mjs --list
//   node scripts/enable-in-project.mjs --project . --plugins dev-agents,context-trim --dry-run
//   node scripts/enable-in-project.mjs --project ../my-app --plugins dev-agents
//   node scripts/enable-in-project.mjs --project . --plugins dev-agents --remove
//   node scripts/enable-in-project.mjs --project . --plugins dev-agents \
//        --source git --url https://github.com/Mouseww/claude-kit.git
//
// Why this exists. A plugin marketplace is a user-level thing: /plugin install
// puts a plugin on YOUR machine, for every project. Making a plugin part of a
// PROJECT is a different mechanism -- two keys in the project's own
// .claude/settings.json, which is committed to the project repository:
//
//   extraKnownMarketplaces : where this marketplace lives
//   enabledPlugins         : which of its plugins this project wants
//
// Anyone who clones that project then gets prompted to install them. This script
// writes exactly those two keys and nothing else.
//
// Safety rules, in order of importance:
//   1. Never drop a key it did not add. Existing settings are deep-merged, and
//      any conflicting scalar keeps the project's value unless --force is given.
//   2. Always write a timestamped .bak of a pre-existing settings.json.
//   3. --dry-run prints the exact resulting file and writes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKETPLACE_FILE = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

// ---- argv -------------------------------------------------------------------

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags.add(key);
    else {
      out.opts[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const DRY = args.flags.has('dry-run');
const REMOVE = args.flags.has('remove');
const FORCE = args.flags.has('force');

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---- marketplace ------------------------------------------------------------

if (!fs.existsSync(MARKETPLACE_FILE)) fail(`marketplace manifest not found: ${MARKETPLACE_FILE}`);

let marketplace;
try {
  marketplace = JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf8'));
} catch (e) {
  fail(`marketplace manifest is not valid JSON: ${e.message}`);
}

const MARKETPLACE_NAME = args.opts['marketplace-name'] || marketplace.name;
if (!MARKETPLACE_NAME) fail('marketplace.json has no "name"');

const available = (marketplace.plugins ?? [])
  .filter((p) => p?.name)
  .map((p) => ({
    name: p.name,
    description: p.description ?? '',
    dir: typeof p.source === 'string' ? path.resolve(REPO_ROOT, p.source) : null,
  }));

/** Count files matching `filter` anywhere under `dir`. Returns 0 if absent. */
function walkCount(dir, filter) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (filter(e.name)) n++;
    }
  }
  return n;
}

/** Human summary of what a plugin ships, e.g. ["10 agents", "hooks"]. */
function contentsOf(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const md = (n) => n.endsWith('.md');
  const counts = [
    // A skill is a directory containing SKILL.md, so count those files.
    ['skill', walkCount(path.join(dir, 'skills'), (n) => n === 'SKILL.md')],
    ['agent', walkCount(path.join(dir, 'agents'), md)],
    ['command', walkCount(path.join(dir, 'commands'), md)],
  ];
  const bits = counts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}${n > 1 ? 's' : ''}`);
  if (fs.existsSync(path.join(dir, 'hooks', 'hooks.json'))) bits.push('hooks');
  return bits;
}

if (args.flags.has('list') || process.argv.length === 2) {
  console.log(`marketplace: ${MARKETPLACE_NAME}  (${REPO_ROOT})`);
  console.log('');
  for (const p of available) {
    const bits = contentsOf(p.dir);
    console.log(`  ${p.name}${bits.length ? `  [${bits.join(', ')}]` : ''}`);
    console.log(`      ${p.description}`);
  }
  console.log('');
  console.log('Enable for a project:');
  console.log(
    `  node "${path.join(REPO_ROOT, 'scripts', 'enable-in-project.mjs')}" --project <dir> --plugins ${available
      .map((p) => p.name)
      .join(',')} --dry-run`
  );
  process.exit(0);
}

// ---- target project ---------------------------------------------------------

const projectDir = path.resolve(args.opts.project || process.cwd());
if (!fs.existsSync(projectDir)) fail(`project directory does not exist: ${projectDir}`);
if (!fs.statSync(projectDir).isDirectory()) fail(`not a directory: ${projectDir}`);

const requested = (args.opts.plugins || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (requested.length === 0) fail('--plugins is required (comma-separated). Use --list to see names.');

const known = new Set(available.map((p) => p.name));
const unknown = requested.filter((n) => !known.has(n));
if (unknown.length) {
  fail(`unknown plugin(s): ${unknown.join(', ')}. Use --list to see what exists.`);
}

// ---- marketplace source -----------------------------------------------------

const sourceKind = args.opts.source || 'directory';
let sourceValue;
if (sourceKind === 'directory') {
  // Forward slashes so the same settings.json is readable on every platform.
  sourceValue = { source: 'directory', path: REPO_ROOT.split(path.sep).join('/') };
} else if (sourceKind === 'git') {
  const url = args.opts.url;
  if (!url) fail('--source git requires --url <repository-url>');
  sourceValue = { source: 'git', url };
} else if (sourceKind === 'github') {
  const repo = args.opts.repo;
  if (!repo) fail('--source github requires --repo <owner/name>');
  sourceValue = { source: 'github', repo };
} else {
  fail(`unknown --source "${sourceKind}" (expected: directory, git, github)`);
}

// ---- merge ------------------------------------------------------------------

const settingsPath = path.join(projectDir, '.claude', 'settings.json');
let existing = {};
let hadFile = false;
if (fs.existsSync(settingsPath)) {
  hadFile = true;
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    fail(`${settingsPath} is not valid JSON (${e.message}). Fix or move it first.`);
  }
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
    fail(`${settingsPath} does not contain a JSON object.`);
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep-merge `patch` into `base` without ever dropping a key `base` already has.
 * On a scalar conflict the base value wins unless --force. Conflicts are
 * collected so the caller can report them instead of silently doing nothing.
 */
function deepMerge(base, patch, conflicts = [], trail = []) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const here = [...trail, k];
    if (!(k in out)) {
      out[k] = v;
    } else if (isPlainObject(out[k]) && isPlainObject(v)) {
      out[k] = deepMerge(out[k], v, conflicts, here);
    } else if (JSON.stringify(out[k]) !== JSON.stringify(v)) {
      conflicts.push({ path: here.join('.'), existing: out[k], incoming: v });
      if (FORCE) out[k] = v;
    }
  }
  return out;
}

let merged;
const conflicts = [];

if (REMOVE) {
  merged = JSON.parse(JSON.stringify(existing));
  for (const name of requested) delete merged.enabledPlugins?.[`${name}@${MARKETPLACE_NAME}`];
  // Drop the marketplace registration only once nothing from it is left enabled.
  const stillUsed = Object.keys(merged.enabledPlugins ?? {}).some((k) =>
    k.endsWith(`@${MARKETPLACE_NAME}`)
  );
  if (!stillUsed) {
    delete merged.extraKnownMarketplaces?.[MARKETPLACE_NAME];
    if (merged.extraKnownMarketplaces && Object.keys(merged.extraKnownMarketplaces).length === 0) {
      delete merged.extraKnownMarketplaces;
    }
  }
  if (merged.enabledPlugins && Object.keys(merged.enabledPlugins).length === 0) {
    delete merged.enabledPlugins;
  }
} else {
  const patch = {
    extraKnownMarketplaces: { [MARKETPLACE_NAME]: { source: sourceValue } },
    enabledPlugins: Object.fromEntries(
      requested.map((name) => [`${name}@${MARKETPLACE_NAME}`, true])
    ),
  };
  merged = deepMerge(existing, patch, conflicts);
}

const before = hadFile ? JSON.stringify(existing, null, 2) + '\n' : '';
const after = JSON.stringify(merged, null, 2) + '\n';

if (conflicts.length) {
  console.log('Conflicting keys already present in the project settings:');
  for (const c of conflicts) {
    console.log(`  ${c.path}`);
    console.log(`    keeping : ${JSON.stringify(c.existing)}`);
    console.log(`    ignored : ${JSON.stringify(c.incoming)}`);
  }
  console.log(FORCE ? '  (--force given: incoming values were applied)' : '  (pass --force to overwrite)');
  console.log('');
}

if (before === after) {
  console.log(`No change needed: ${settingsPath}`);
  process.exit(0);
}

console.log(`${DRY ? 'Would write' : 'Writing'}: ${settingsPath}`);
console.log('');
console.log(diff(before, after));

if (DRY) {
  console.log('');
  console.log('Dry run: nothing was written. Re-run without --dry-run to apply.');
  process.exit(0);
}

if (hadFile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${settingsPath}.${stamp}.bak`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`Backup: ${backup}`);
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, after);

console.log('');
console.log('Done. Next:');
console.log('  1. Run /plugin (or restart the session) so Claude Code picks the plugins up.');
console.log('  2. Commit .claude/settings.json so the rest of the team gets the same prompt.');

/**
 * Line diff via longest common subsequence. Settings files are small, so the
 * O(n*m) table is free, and it is worth doing properly: a set-based diff reports
 * a line whose only change is a trailing comma as one delete plus one insert,
 * which reads like the value was touched when it was not. The user is being
 * asked to approve this output, so it has to be honest.
 */
function diff(a, b) {
  const A = a ? a.replace(/\n$/, '').split('\n') : [];
  const B = b.replace(/\n$/, '').split('\n');

  const n = A.length;
  const m = B.length;
  // lcs[i][j] = length of the LCS of A[i..] and B[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = A[i] === B[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push(`  ${A[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`- ${A[i]}`);
      i++;
    } else {
      out.push(`+ ${B[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`- ${A[i++]}`);
  while (j < m) out.push(`+ ${B[j++]}`);
  return out.join('\n');
}
