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
//   every agent `skills:` entry resolves to a repo skill or     - a typo in a skill
//     is declared in that agent's own plugin.json                 name would load
//     "externalSkills"                                            silently wrong, or
//                                                                  not load at all

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasAgentTool,
  readSkillsList,
  bodyLinesAfterFrontmatter,
  findDispatchViolations,
  findUnresolvedSkills,
  findStaleExternalSkills,
} from './agent-nesting-rules.mjs';

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

// ---- repo-wide skill names ---------------------------------------------------
// Built once, across every plugin, before any single plugin is validated: an
// agent's `skills:` entry can legitimately name a skill that ships in a
// different plugin than the agent's own.
const repoSkillNames = new Set();
for (const skillFile of walk(path.join(ROOT, 'plugins'), (n) => n === 'SKILL.md')) {
  const skillName = path.basename(path.dirname(skillFile));
  repoSkillNames.add(skillName);
  // Also index the "plugin:skill" namespaced form, so a cross-pack reference
  // like "dev-agents:dev-agents" resolves the same way a bare name does.
  const pluginName = path.basename(path.dirname(path.dirname(path.dirname(skillFile))));
  repoSkillNames.add(`${pluginName}:${skillName}`);
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
  checkPluginManifestShape(plugin, manifest);

  // "externalSkills" documents skills an agent references that are not shipped
  // in this repo (they live in a user's global ~/.claude/skills or another
  // marketplace). If one of those names now matches a skill that does exist
  // in-repo, the allow-list entry is stale and should be deleted instead of
  // shadowing the real skill.
  for (const skillName of findStaleExternalSkills(plugin.externalSkills, repoSkillNames)) {
    warn(
      manifest,
      `"externalSkills.${skillName}" is listed as external, but plugins/*/skills/${skillName}/SKILL.md exists in this repo now; remove the stale entry`
    );
  }

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

    // A skill can declare its own `skills:` list (a sibling or cross-pack
    // dependency). Those entries must resolve the same way an agent's
    // `skills:` entries do, via the same helper, or a typo/rename ships
    // silently and only fails at runtime.
    const skillText = fs.readFileSync(skill, 'utf8');
    const skillSkills = readSkillsList(skillText);
    for (const skillName of findUnresolvedSkills(skillSkills, repoSkillNames, plugin.externalSkills)) {
      err(
        skill,
        `declares skill "${skillName}" which is not plugins/*/skills/${skillName}/SKILL.md in this repo and is not listed in ${path.basename(dir)}/.claude-plugin/plugin.json "externalSkills"`
      );
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

    const agentText = fs.readFileSync(agent, 'utf8');
    const agentSkills = readSkillsList(agentText);

    // Every skill an agent declares must be findable somewhere: shipped as
    // plugins/*/skills/<name>/SKILL.md in this repo, or documented as a
    // deliberate external dependency in the agent's own plugin.json. Without
    // this check a typo'd skill name (or one that only exists in a user's
    // personal ~/.claude/skills) passes CI silently and just never loads.
    for (const skillName of findUnresolvedSkills(agentSkills, repoSkillNames, plugin.externalSkills)) {
      err(
        agent,
        `declares skill "${skillName}" which is not plugins/*/skills/${skillName}/SKILL.md in this repo and is not listed in ${path.basename(dir)}/.claude-plugin/plugin.json "externalSkills"`
      );
    }

    // An agent granted the Agent tool can spawn nested subagents. The
    // nesting-discipline skill is what restricts those nested calls to
    // quick-read/quick-io; an Agent-tool agent without it has no guardrail
    // against nesting a full role agent, which blocks the parent for the
    // nested child's entire duration.
    if (hasAgentTool(fm.tools)) {
      const text = agentText;
      const skills = agentSkills;
      if (!skills.includes('nesting-discipline')) {
        err(agent, 'is granted the Agent tool but does not carry the nesting-discipline skill');
      }

      // The body is always resident in the agent's prompt; a skill is only
      // conditionally loaded. When the two disagree the body wins silently,
      // so a body line telling the agent to dispatch another role agent is
      // a real contradiction even with the skill present. Frontmatter is
      // never scanned here: `description:` legitimately names other agents
      // as caller-facing guidance.
      const { startLine, lines } = bodyLinesAfterFrontmatter(text);
      for (const v of findDispatchViolations(lines, startLine)) {
        err(
          agent,
          `line ${v.line}: dispatches \`dev-agents:${v.target}\` via "${v.verb}"; only dev-agents:quick-read or dev-agents:quick-io may be dispatched from a role agent`
        );
      }
    }
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
      if (m != null && m.matcher != null && typeof m.matcher !== 'string') {
        err(hooksFile, `"${event}" matcher must be a string`);
      }
      if (!Array.isArray(m?.hooks) || m.hooks.length === 0) {
        err(hooksFile, `"${event}" has a matcher group with no hooks`);
      }
      for (const h of m?.hooks ?? []) {
        if (h?.type !== 'command' || typeof h.command !== 'string') continue;

        // Cross-platform rule: hook entry points are node scripts in this repo.
        if (/\.(sh|ps1|bat|cmd)\b/.test(h.command)) {
          err(hooksFile, `"${event}" hook invokes a shell script; this repo uses node (.mjs) entry points only`);
        }

        if (!/^node\s/.test(h.command.trim())) {
          err(hooksFile, `"${event}" hook command does not start with "node": ${h.command}`);
        }
        if (h.timeout != null) {
          if (!Number.isInteger(h.timeout) || h.timeout < 1 || h.timeout > 600) {
            err(hooksFile, `"${event}" hook timeout ${h.timeout} must be an integer between 1 and 600`);
          }
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

// Mirrors schemas/plugin.schema.json. The schema file is for editor completion;
// this is the copy CI actually runs, because this repo installs no dependencies
// and therefore has no schema engine.
function checkPluginManifestShape(plugin, manifestFile) {
  if (plugin.version != null && !/^\d+\.\d+\.\d+$/.test(String(plugin.version))) {
    err(manifestFile, `version "${plugin.version}" is not a bare x.y.z semver`);
  }
  if (plugin.name != null && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(plugin.name))) {
    err(manifestFile, `name "${plugin.name}" is not lower-kebab-case`);
  }
  if (plugin.defaultEnabled != null && typeof plugin.defaultEnabled !== 'boolean') {
    err(manifestFile, '"defaultEnabled" must be a boolean');
  }
  if (plugin.keywords != null && !Array.isArray(plugin.keywords)) {
    err(manifestFile, '"keywords" must be an array');
  }
  if (plugin.externalSkills != null) {
    if (typeof plugin.externalSkills !== 'object' || Array.isArray(plugin.externalSkills)) {
      err(manifestFile, '"externalSkills" must be an object of name -> reason');
    } else {
      for (const [k, v] of Object.entries(plugin.externalSkills)) {
        if (typeof v !== 'string' || v.length === 0) {
          err(manifestFile, `"externalSkills.${k}" must be a non-empty string saying where it lives`);
        }
      }
    }
  }
  if (plugin.$schema != null && plugin.$schema !== '../../../schemas/plugin.schema.json') {
    warn(manifestFile, `"$schema" should be "../../../schemas/plugin.schema.json"`);
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
