#!/usr/bin/env node
// Install or update a pack's managed block inside a CLAUDE.md.
//
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user --dry-run
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target project
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target ./some/CLAUDE.md
//   node scripts/sync-claude-md.mjs --plugin dev-agents --target user --remove
//   node scripts/sync-claude-md.mjs --heal
//
// Why a CLAUDE.md block at all. A skill body only enters context when the skill
// is invoked; a CLAUDE.md block is resident on every turn. Guidance that should
// change behaviour by default belongs in the block, and the long reference
// belongs in the skill. The block is therefore a real always-on token cost and
// should stay short.
//
// This script is location-independent: ROOT is always dirname(this file)/...
// Two ways it ships:
//
//   - In this repo, at scripts/sync-claude-md.mjs, where ROOT is the repo root
//     and callers pass --plugin <name> to pick plugins/<name>/claude-md-block.md.
//   - Byte-identical, inside an installed plugin at
//     <plugin>/scripts/sync-claude-md.mjs, where ROOT is the plugin's own root
//     and --plugin is omitted: the block is ROOT/claude-md-block.md, i.e. the
//     plugin's own block, next to this script.
//
// The pack's claude-md-block.md carries frontmatter naming the marker and any
// older marker names it replaces:
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
// --heal is the non-interactive mode a SessionStart hook runs: it refreshes a
// user's existing managed block after a plugin update, without any prompt.
// Unlike the interactive mode above, it never creates a file and never adds a
// block that was not already there — see runHeal() for its exact rules.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
const HEAL = args.flags.has('heal');

function fail(msg) {
  throw new Error(msg);
}

// --- shared:readStdin --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Two deadlines on purpose. The idle timer covers the common case of a stream
// that goes quiet without an end event. The absolute one covers a stream that
// keeps producing, which resets the idle timer forever and used to mean this
// never resolved at all. Both resolve with whatever arrived; a partial body
// fails JSON.parse and every caller treats that as "do nothing".
//
// finish() detaches from stdin as well as resolving. Resolving alone is not
// enough: a stream that is still flowing keeps the process alive long after the
// promise settles, so the hook would sail past its own deadline and hang. The
// detach is what makes the absolute deadline actually bound the process.
function readStdin(idleMs = 5000, absoluteMs = 30000) {
  return new Promise((resolve) => {
    let buf = '';
    let idle = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (idle) clearTimeout(idle);
      clearTimeout(hard);
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
      resolve(buf);
    };
    const hard = setTimeout(finish, absoluteMs);
    hard.unref();
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(finish, idleMs);
      idle.unref();
    };
    process.stdin.setEncoding('utf8');
    resetIdle();
    process.stdin.on('data', (c) => {
      buf += c;
      resetIdle();
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}
// --- /shared:readStdin ---

// ---- the block -----------------------------------------------------------

/** Load the block for --plugin <name> (repo usage) or ROOT/claude-md-block.md
 * (installed-plugin usage, ROOT being the plugin's own root). Throws via
 * fail() on anything malformed. */
function loadBlock() {
  const pluginName = args.opts.plugin;
  const blockFile = pluginName
    ? path.join(ROOT, 'plugins', pluginName, 'claude-md-block.md')
    : path.join(ROOT, 'claude-md-block.md');

  if (!fs.existsSync(blockFile)) {
    fail(
      pluginName
        ? `${pluginName} ships no claude-md-block.md (looked in ${path.relative(ROOT, blockFile)})`
        : `no claude-md-block.md found (looked in ${blockFile})`
    );
  }

  const blockRaw = fs.readFileSync(blockFile, 'utf8').replace(/^﻿/, '');
  let markerName = pluginName || null;
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
  if (!markerName) {
    fail(`${blockFile}: no --plugin given and no "markers:" in frontmatter; cannot determine the marker name`);
  }

  return { markerName, supersedes, blockBody, blockFile };
}

// ---- reading a target, preserving every incidental property of the file ---

function readTarget(targetFile) {
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

  return { original, hadFile, hasBom, EOL, endedWithNewline, lines };
}

// ---- locate managed regions -----------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Tolerant of extra whitespace and leading indentation, so a block a user
// reflowed by hand is still recognised as the same managed region.
const markerRe = (kind, n) =>
  new RegExp(`^[ \\t]*<!--\\s*${kind}\\s+${escapeRe(n)}\\s*\\(managed\\)\\s*-->[ \\t]*$`);

/** Find every [start,end] line-index pair for one marker name. Bails if unbalanced. */
function findRegions(lines, name, targetFile) {
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

/** All regions (primary + legacy/superseded), sorted, with an overlap check. */
function locateRegions(lines, markerName, supersedes, targetFile) {
  const primary = findRegions(lines, markerName, targetFile).map((r) => ({
    range: r,
    name: markerName,
    legacy: false,
  }));
  const legacy = supersedes.flatMap((n) =>
    findRegions(lines, n, targetFile).map((r) => ({ range: r, name: n, legacy: true }))
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
  return all;
}

// ---- build the new content -------------------------------------------------

function buildUpdate({ lines, all, markerName, blockBody, hadFile, remove, targetFile }) {
  const managed = [
    `<!-- BEGIN ${markerName} (managed) -->`,
    ...blockBody.split('\n'),
    `<!-- END ${markerName} (managed) -->`,
  ];

  const actions = [];
  let outLines;

  if (remove) {
    if (all.length === 0) return { outLines: null, actions: [], nothingToRemove: true };
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

  return { outLines, actions, nothingToRemove: false };
}

function applyEnvelope({ outLines, EOL, endedWithNewline, hasBom }) {
  let after = outLines.join(EOL);
  if (endedWithNewline && after !== '') after += EOL;
  if (hasBom) after = '﻿' + after;
  return after;
}

// ---- interactive / repo mode ------------------------------------------------

function runInteractive() {
  const { markerName, blockBody, supersedes } = loadBlock();

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

  const { original, hadFile, hasBom, EOL, endedWithNewline, lines } = readTarget(targetFile);
  const all = locateRegions(lines, markerName, supersedes, targetFile);

  if (REMOVE && all.length === 0) {
    console.log(`No managed block for "${markerName}" in ${targetFile}; nothing to remove.`);
    process.exit(0);
  }

  const { outLines, actions } = buildUpdate({
    lines,
    all,
    markerName,
    blockBody,
    hadFile,
    remove: REMOVE,
    targetFile,
  });

  const after = applyEnvelope({ outLines, EOL, endedWithNewline, hasBom });

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
}

// ---- --heal: non-interactive refresh from a SessionStart hook ---------------
//
// Rules (deliberately stricter than the interactive mode above):
//   - Targets are always ~/.claude/CLAUDE.md and <cwd>/CLAUDE.md.
//   - A target is only touched when it exists AND already contains this pack's
//     BEGIN marker or a superseded marker. Never create a file, never append a
//     block that is not already there.
//   - A target whose markers are unbalanced is skipped silently, not failed.
//   - Always exits 0. On any error, nothing is written.
//   - CLAUDE_KIT_NO_HEAL=1 opts out entirely.
async function runHeal() {
  await readStdin();

  if (process.env.CLAUDE_KIT_NO_HEAL === '1') return;

  const { markerName, blockBody, supersedes } = loadBlock();

  const candidates = [path.join(os.homedir(), '.claude', 'CLAUDE.md'), path.join(process.cwd(), 'CLAUDE.md')];
  const targets = [...new Set(candidates)];

  const changedPaths = [];
  const backups = [];

  for (const targetFile of targets) {
    try {
      if (!fs.existsSync(targetFile)) continue;

      const { original, hadFile, hasBom, EOL, endedWithNewline, lines } = readTarget(targetFile);
      const all = locateRegions(lines, markerName, supersedes, targetFile);
      if (all.length === 0) continue; // marker not already present: never adopt this file

      const { outLines } = buildUpdate({
        lines,
        all,
        markerName,
        blockBody,
        hadFile,
        remove: false,
        targetFile,
      });
      const after = applyEnvelope({ outLines, EOL, endedWithNewline, hasBom });

      if (after === original) continue;

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = `${targetFile}.${stamp}.bak`;
      fs.copyFileSync(targetFile, backup);
      fs.writeFileSync(targetFile, after);
      changedPaths.push(targetFile);
      backups.push(backup);
    } catch {
      // Unbalanced markers or any other per-target problem: skip that target,
      // keep going with the rest.
      continue;
    }
  }

  if (changedPaths.length > 0) {
    const msg =
      `${markerName}: refreshed the managed block in ${changedPaths.join(', ')}; ` +
      `takes effect in the next session. Backup: ${backups.join(', ')}`;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
      })
    );
  }
}

// ---- entry point -------------------------------------------------------------

if (HEAL) {
  runHeal()
    .catch(() => {})
    .finally(() => process.exit(0));
} else {
  try {
    runInteractive();
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

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
