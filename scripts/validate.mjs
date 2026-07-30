#!/usr/bin/env node
// Structural validator for this claude-kit repository.
//
//   node scripts/validate.mjs
//
// Exits non-zero on any error. Warnings do not fail the run.
//
// What it checks, and why each check exists:
//
//   marketplace.json parses, has name/owner/plugins            - a broken manifest
//                                                                makes the whole
//                                                                marketplace unusable
//   every plugin `source` path exists and holds a plugin.json  - the commonest
//                                                                mistake when adding
//                                                                a pack
//   plugin.json `name` equals its directory name               - Claude Code
//                                                                namespaces commands
//                                                                and agents by plugin
//                                                                name; a mismatch
//                                                                silently changes
//                                                                every /command path
//   every plugin directory is listed in marketplace.json       - an unlisted pack is
//                                                                invisible and looks
//                                                                like a bug later
//   SKILL.md frontmatter has name + description, name matches  - the description is
//     its directory                                              what the model reads
//                                                                to decide relevance
//   agent/command frontmatter has name/description             - same reason
//   hooks.json parses and every script it references exists    - a dangling hook
//                                                                command fails
//                                                                silently on every
//                                                                tool call
//   hook commands use node, not sh/ps1                         - this repo's
//                                                                cross-platform rule
//                                                                (see CONTRIBUTING.md)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const err = (file, msg) => errors.push(`${rel(file)}: ${msg}`);
const warn = (file, msg) => warnings.push(`${rel(file)}: ${msg}`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    err(file, `invalid JSON: ${e.message}`);
    return null;
  }
}

// Minimal YAML frontmatter reader: only the top-level `key: value` pairs this
// repository actually uses. A full YAML parser would be a dependency for no gain.
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(text.indexOf('\n', 3) + 1, end + 1);
  const out = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function walk(dir, filter) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, filter));
    else if (filter(entry.name)) out.push(p);
  }
  return out;
}

// ---- marketplace manifest ---------------------------------------------------

const marketplaceFile = path.join(ROOT, '.claude-plugin', 'marketplace.json');
if (!fs.existsSync(marketplaceFile)) {
  err(marketplaceFile, 'missing; every marketplace repository needs this file');
  report();
}

const marketplace = readJson(marketplaceFile);
if (!marketplace) report();

for (const key of ['name', 'owner', 'plugins']) {
  if (marketplace[key] == null) err(marketplaceFile, `missing required key "${key}"`);
}
if (!Array.isArray(marketplace.plugins)) {
  err(marketplaceFile, '"plugins" must be an array');
  report();
}

const listed = new Set();

for (const entry of marketplace.plugins) {
  const label = entry?.name || '(unnamed)';
  if (!entry?.name) err(marketplaceFile, 'a plugin entry has no "name"');
  if (!entry?.description) err(marketplaceFile, `plugin "${label}" has no "description"`);
  if (typeof entry?.source !== 'string') {
    // Remote sources (git-subdir etc.) are legal but nothing local to check.
    if (entry?.source) warn(marketplaceFile, `plugin "${label}" uses a remote source; skipped`);
    else err(marketplaceFile, `plugin "${label}" has no "source"`);
    continue;
  }

  const dir = path.resolve(ROOT, entry.source);
  if (!fs.existsSync(dir)) {
    err(marketplaceFile, `plugin "${label}" source "${entry.source}" does not exist`);
    continue;
  }
  listed.add(path.resolve(dir));

  const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifest)) {
    err(dir, `no .claude-plugin/plugin.json (referenced as "${label}")`);
    continue;
  }

  const plugin = readJson(manifest);
  if (!plugin) continue;

  if (!plugin.name) err(manifest, 'missing "name"');
  else if (plugin.name !== path.basename(dir)) {
    err(manifest, `"name" is "${plugin.name}" but the directory is "${path.basename(dir)}"`);
  } else if (plugin.name !== entry.name) {
    err(manifest, `"name" is "${plugin.name}" but marketplace.json lists it as "${entry.name}"`);
  }
  if (!plugin.description) err(manifest, 'missing "description"');
  if (!plugin.version) warn(manifest, 'no "version"; bump it when the pack changes');

  // ---- hooks ----------------------------------------------------------------
  // hooks/hooks.json is loaded automatically by Claude Code. Naming it in the
  // manifest makes the plugin fail to load outright:
  //   "Duplicate hooks file detected: ./hooks/hooks.json resolves to an
  //    already-loaded file. The standard hooks/hooks.json is loaded
  //    automatically, so manifest.hooks should only reference additional files."
  // Both shipped packs had this and both were dead on arrival until the CLI said
  // so. The manifest key is only for EXTRA hook files beyond the standard one.
  const standardHooks = path.join(dir, 'hooks', 'hooks.json');
  const declared = plugin.hooks ? [].concat(plugin.hooks) : [];

  for (const entry of declared) {
    const hooksFile = path.resolve(dir, entry);
    if (path.resolve(standardHooks) === hooksFile) {
      err(
        manifest,
        `"hooks" names the standard hooks/hooks.json, which is auto-loaded; the plugin will fail to load with a duplicate-hooks error. Remove the "hooks" key.`
      );
      continue;
    }
    if (!fs.existsSync(hooksFile)) {
      err(manifest, `"hooks" points at "${entry}" which does not exist`);
      continue;
    }
    const hooks = readJson(hooksFile);
    if (hooks) checkHookCommands(hooks, hooksFile, dir);
  }

  if (fs.existsSync(standardHooks)) {
    const hooks = readJson(standardHooks);
    if (hooks) checkHookCommands(hooks, standardHooks, dir);
  }

  // ---- empty capability directories ------------------------------------------
  // An empty skills/ or agents/ directory means the pack advertises something it
  // does not ship. This is not hypothetical: dev-agents shipped an empty
  // skills/dev-agents/ for months while its plugin.json claimed "includes a
  // delegation strategy skill". Nothing surfaced the discrepancy, and git does
  // not track empty directories, so it was invisible in review too.
  for (const sub of ['skills', 'agents', 'commands']) {
    const capDir = path.join(dir, sub);
    if (!fs.existsSync(capDir)) continue;
    const found = walk(capDir, (n) => n.endsWith('.md'));
    if (found.length === 0) {
      err(capDir, `directory exists but ships nothing; delete it or add content`);
    }
  }
  // A skill is a directory holding SKILL.md. A subdirectory of skills/ without
  // one is a half-created skill that will never load.
  const skillsRoot = path.join(dir, 'skills');
  if (fs.existsSync(skillsRoot)) {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md'))) {
        err(path.join(skillsRoot, entry.name), 'no SKILL.md, so this skill cannot load');
      }
    }
  }

  // ---- skills ---------------------------------------------------------------
  for (const skill of walk(path.join(dir, 'skills'), (n) => n === 'SKILL.md')) {
    const fm = frontmatter(skill);
    if (!fm) {
      err(skill, 'no YAML frontmatter');
      continue;
    }
    if (!fm.name) err(skill, 'frontmatter missing "name"');
    else if (fm.name !== path.basename(path.dirname(skill))) {
      err(skill, `frontmatter name "${fm.name}" does not match its directory "${path.basename(path.dirname(skill))}"`);
    }
    if (!fm.description) err(skill, 'frontmatter missing "description"');
    else if (fm.description.length < 40) {
      warn(skill, 'description is very short; it is what the model reads to decide relevance');
    }
  }

  // ---- agents ---------------------------------------------------------------
  for (const agent of walk(path.join(dir, 'agents'), (n) => n.endsWith('.md'))) {
    const fm = frontmatter(agent);
    if (!fm) {
      err(agent, 'no YAML frontmatter');
      continue;
    }
    if (!fm.name) err(agent, 'frontmatter missing "name"');
    else if (fm.name !== path.basename(agent, '.md')) {
      err(agent, `frontmatter name "${fm.name}" does not match the filename`);
    }
    if (!fm.description) err(agent, 'frontmatter missing "description"');
  }

  // ---- commands -------------------------------------------------------------
  for (const cmd of walk(path.join(dir, 'commands'), (n) => n.endsWith('.md'))) {
    const fm = frontmatter(cmd);
    if (!fm) {
      err(cmd, 'no YAML frontmatter');
      continue;
    }
    if (!fm.description) err(cmd, 'frontmatter missing "description"');
  }
}

// ---- every plugin directory must be listed ----------------------------------

const pluginsDir = path.join(ROOT, 'plugins');
if (fs.existsSync(pluginsDir)) {
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.resolve(pluginsDir, entry.name);
    if (!listed.has(dir)) {
      err(dir, 'not listed in .claude-plugin/marketplace.json, so nobody can install it');
    }
  }
}

// -----------------------------------------------------------------------------

function checkHookCommands(hooks, hooksFile, pluginDir) {
  const groups = hooks?.hooks;
  if (!groups || typeof groups !== 'object') {
    err(hooksFile, 'missing top-level "hooks" object');
    return;
  }
  for (const [event, matchers] of Object.entries(groups)) {
    if (!Array.isArray(matchers)) {
      err(hooksFile, `"${event}" must be an array`);
      continue;
    }
    for (const m of matchers) {
      for (const h of m?.hooks ?? []) {
        if (h?.type !== 'command' || typeof h.command !== 'string') continue;

        // Cross-platform rule: hook entry points are node scripts in this repo.
        if (/\.(sh|ps1|bat|cmd)\b/.test(h.command)) {
          err(hooksFile, `"${event}" hook invokes a shell script; this repo uses node (.mjs) entry points only`);
        }

        // Resolve every ${CLAUDE_PLUGIN_ROOT}-relative path it mentions and
        // confirm the file is actually there. A dangling hook command fails
        // silently on every single tool call.
        for (const match of h.command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^"'\s]*)/g)) {
          const target = path.resolve(pluginDir, '.' + match[1]);
          if (!fs.existsSync(target)) {
            err(hooksFile, `"${event}" hook references missing file: ${rel(target)}`);
          }
        }
      }
    }
  }
}

function report() {
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  console.log('');
  if (errors.length) {
    console.log(`FAIL: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }
  console.log(`OK: 0 errors, ${warnings.length} warning(s)`);
  process.exit(0);
}

report();
