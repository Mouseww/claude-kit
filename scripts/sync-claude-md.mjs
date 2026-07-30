#!/usr/bin/env node
// Install or update a pack's managed block inside a CLAUDE.md.
//
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user --dry-run
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target project
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target ./some/CLAUDE.md
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user --remove
//
// Why a CLAUDE.md block at all. A skill body only enters context when the skill
// is invoked; a CLAUDE.md block is resident on every turn. Guidance that should
// change behaviour by default belongs in the block, and the long reference
// belongs in the skill. The block is therefore a real always-on token cost and
// should stay short.
//
// The pack supplies plugins/<name>/claude-md-block.md, whose frontmatter names
// the marker and any older marker names it replaces:
//
//   ---
//   markers: dev-agents
//   supersedes: [context-offload]
//   ---
//   ...block body...
//
// `supersedes` is what stops a rename from silently leaving two contradictory
// delegation blocks resident in the same file.
//
// Safety rules, in priority order:
//
//   1. Only ever modify bytes between a BEGIN/END marker pair, or append at the
//      end. Everything else in the file is passed through untouched, including
//      its line endings, its BOM, and whether it ended with a newline.
//   2. Refuse to write on anything ambiguous — an unbalanced or crossed marker
//      pair — rather than guessing where the block was meant to go.
//   3. Timestamped .bak before overwriting.
//   4. --dry-run prints an LCS diff and writes nothing.
//   5. Idempotent: running twice in a row reports no change the second time.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---- the block ---------------------------------------------------------------

const pluginName = args.opts.plugin;
if (!pluginName) fail('--plugin <name> is required');

const blockFile = path.join(REPO_ROOT, 'plugins', pluginName, 'claude-md-block.md');
if (!fs.existsSync(blockFile)) {
  fail(`${pluginName} ships no claude-md-block.md (looked in ${path.relative(REPO_ROOT, blockFile)})`);
}

const blockRaw = fs.readFileSync(blockFile, 'utf8').replace(/^﻿/, '');
let markerName = pluginName;
let supersedes = [];
let blockBody = blockRaw;

if (blockRaw.startsWith('---')) {
  const end = blockRaw.indexOf('\n---', 3);
  if (end === -1) fail(`${blockFile}: frontmatter opened but never closed`);
  const fm = blockRaw.slice(blockRaw.indexOf('\n', 3) + 1, end + 1);
  blockBody = blockRaw.slice(blockRaw.indexOf('\n', end + 1) + 1);
  for (const line of fm.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim();
    if (m[1] === 'markers') markerName = v.replace(/^["']|["']$/g, '');
    if (m[1] === 'supersedes') {
      supersedes = v
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }
}

blockBody = blockBody.replace(/^\n+/, '').replace(/\s+$/, '');
if (!blockBody) fail(`${blockFile}: block body is empty`);

// ---- target ------------------------------------------------------------------

const targetArg = args.opts.target || 'project';
let targetFile;
if (targetArg === 'user') targetFile = path.join(os.homedir(), '.claude', 'CLAUDE.md');
else if (targetArg === 'project') targetFile = path.join(process.cwd(), 'CLAUDE.md');
else {
  targetFile = path.resolve(targetArg);
  if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
    targetFile = path.join(targetFile, 'CLAUDE.md');
  }
}

// ---- read, preserving every incidental property of the file --------------------

let original = '';
let hadFile = false;
if (fs.existsSync(targetFile)) {
  hadFile = true;
  original = fs.readFileSync(targetFile, 'utf8');
}

const hasBom = original.startsWith('﻿');
const text = hasBom ? original.slice(1) : original;
// Preserve the file's dominant line ending. Rewriting a CRLF file with LF would
// show up as every line changed, which defeats the point of a surgical edit.
const crlf = (text.match(/\r\n/g) || []).length;
const lfOnly = (text.match(/(?<!\r)\n/g) || []).length;
const EOL = crlf > 0 && crlf >= lfOnly ? '\r\n' : '\n';
const endedWithNewline = text === '' ? true : /\n$/.test(text);

const lines = text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

// ---- locate managed regions ----------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Tolerant of extra whitespace and leading indentation, so a block a user
// reflowed by hand is still recognised as the same managed region.
const markerRe = (kind, n) =>
  new RegExp(`^[ \\t]*<!--\\s*${kind}\\s+${escapeRe(n)}\\s*\\(managed\\)\\s*-->[ \\t]*$`);

/** Find every [start,end] line-index pair for one marker name. Bails if unbalanced. */
function findRegions(name) {
  const b = markerRe('BEGIN', name);
  const e = markerRe('END', name);
  const regions = [];
  let open = -1;
  for (let i = 0; i < lines.length; i++) {
    if (b.test(lines[i])) {
      if (open !== -1) {
        fail(
          `${targetFile}: a second "BEGIN ${name} (managed)" at line ${i + 1} before the previous one closed. ` +
            'Fix the markers by hand; refusing to guess.'
        );
      }
      open = i;
    } else if (e.test(lines[i])) {
      if (open === -1) {
        fail(
          `${targetFile}: "END ${name} (managed)" at line ${i + 1} with no matching BEGIN. ` +
            'Fix the markers by hand; refusing to guess.'
        );
      }
      regions.push([open, i]);
      open = -1;
    }
  }
  if (open !== -1) {
    fail(
      `${targetFile}: "BEGIN ${name} (managed)" at line ${open + 1} is never closed. ` +
        'Fix the markers by hand; refusing to guess.'
    );
  }
  return regions;
}

const primary = findRegions(markerName).map((r) => ({ range: r, name: markerName, legacy: false }));
const legacy = supersedes.flatMap((n) =>
  findRegions(n).map((r) => ({ range: r, name: n, legacy: true }))
);

const all = [...primary, ...legacy].sort((a, b) => a.range[0] - b.range[0]);

// Overlapping regions from different marker names means the file is malformed in
// a way we must not paper over.
for (let i = 1; i < all.length; i++) {
  if (all[i].range[0] <= all[i - 1].range[1]) {
    fail(
      `${targetFile}: managed regions for "${all[i - 1].name}" and "${all[i].name}" overlap. ` +
        'Fix the markers by hand; refusing to guess.'
    );
  }
}

// ---- build the new content ------------------------------------------------------

const managed = [
  `<!-- BEGIN ${markerName} (managed) -->`,
  ...blockBody.split('\n'),
  `<!-- END ${markerName} (managed) -->`,
];

const actions = [];
let outLines;

if (REMOVE) {
  if (all.length === 0) {
    console.log(`No managed block for "${markerName}" in ${targetFile}; nothing to remove.`);
    process.exit(0);
  }
  outLines = [];
  let cursor = 0;
  for (const r of all) {
    outLines.push(...lines.slice(cursor, r.range[0]));
    // Swallow one blank separator line left behind by the removal.
    cursor = r.range[1] + 1;
    if (lines[cursor] === '' && outLines[outLines.length - 1] === '') cursor++;
    actions.push(`removed the "${r.name}" block`);
  }
  outLines.push(...lines.slice(cursor));
} else if (all.length > 0) {
  // Replace the first region in file order, wherever it is, and delete the rest.
  // Replacing in place matters: the block keeps whatever position the user chose
  // for it in their CLAUDE.md.
  const [first, ...rest] = all;
  outLines = [];
  let cursor = 0;

  outLines.push(...lines.slice(cursor, first.range[0]));
  outLines.push(...managed);
  cursor = first.range[1] + 1;
  actions.push(
    first.legacy
      ? `replaced the superseded "${first.name}" block with "${markerName}", in place`
      : `updated the "${markerName}" block in place`
  );

  for (const r of rest) {
    outLines.push(...lines.slice(cursor, r.range[0]));
    cursor = r.range[1] + 1;
    if (lines[cursor] === '' && outLines[outLines.length - 1] === '') cursor++;
    actions.push(
      r.legacy
        ? `removed the superseded "${r.name}" block`
        : `removed a duplicate "${markerName}" block`
    );
  }
  outLines.push(...lines.slice(cursor));
} else {
  outLines = [...lines];
  if (outLines.length > 0 && outLines[outLines.length - 1] !== '') outLines.push('');
  outLines.push(...managed);
  actions.push(hadFile ? `appended the "${markerName}" block` : `created ${path.basename(targetFile)}`);
}

let after = outLines.join(EOL);
if (endedWithNewline && after !== '') after += EOL;
if (hasBom) after = '﻿' + after;

// ---- report and write ------------------------------------------------------------

if (after === original) {
  console.log(`No change needed: ${targetFile}`);
  process.exit(0);
}

console.log(`${DRY ? 'Would update' : 'Updating'}: ${targetFile}`);
for (const a of actions) console.log(`  - ${a}`);
console.log('');
console.log(diff(original.replace(/^﻿/, ''), after.replace(/^﻿/, '')));

if (DRY) {
  console.log('');
  console.log('Dry run: nothing was written. Re-run without --dry-run to apply.');
  process.exit(0);
}

if (hadFile) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${targetFile}.${stamp}.bak`;
  fs.copyFileSync(targetFile, backup);
  console.log(`Backup: ${backup}`);
}

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, after);
console.log('Done.');

/** Line diff via longest common subsequence. Same implementation as enable-in-project.mjs. */
function diff(a, b) {
  const A = a === '' ? [] : a.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const B = b === '' ? [] : b.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const n = A.length;
  const m = B.length;
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
      // Collapse long runs of unchanged context so the diff stays readable.
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
  return collapse(out);
}

/** Keep 2 lines of context around each change; replace long unchanged runs with a marker. */
function collapse(rows) {
  const keep = new Set();
  rows.forEach((r, i) => {
    if (r[0] === '+' || r[0] === '-') {
      for (let k = Math.max(0, i - 2); k <= Math.min(rows.length - 1, i + 2); k++) keep.add(k);
    }
  });
  const out = [];
  let skipping = false;
  rows.forEach((r, i) => {
    if (keep.has(i)) {
      out.push(r);
      skipping = false;
    } else if (!skipping) {
      out.push('  ...');
      skipping = true;
    }
  });
  return out.join('\n');
}
