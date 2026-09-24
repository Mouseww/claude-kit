#!/usr/bin/env node
// Launcher that runs a script from the claude-kit marketplace repository's
// own scripts/ directory, from inside an installed plugin.
//
//   node repo-script.mjs <script-name> [args...]
//   node repo-script.mjs --root
//
// Why this exists. Commands like /install-here used to reach for their
// script with `${CLAUDE_PLUGIN_ROOT}/../../scripts/foo.mjs`. That only works
// when the plugin is running straight out of a repo checkout. For anyone who
// actually installed claude-kit as a plugin, Claude Code copies each plugin
// into an isolated per-version cache directory
// (~/.claude/plugins/cache/claude-kit/<plugin>/<version>/), so
// `${CLAUDE_PLUGIN_ROOT}/../..` lands two levels above that cache copy --
// nowhere near the real marketplace repo. See validate.mjs's
// PLUGIN_ROOT_ESCAPE_RE check, which now catches this class of mistake.
//
// This script finds the real repo root instead, using the same
// known_marketplaces.json that Claude Code itself maintains, and execs the
// requested script from there.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getMarketplaceRootCandidates } from './marketplace-source.mjs';

const MARKETPLACE_NAME = 'claude-kit';
const SCRIPT_NAME_RE = /^[a-z0-9-]+$/;

// This file lives at <plugin root>/scripts/repo-script.mjs.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hasMarketplaceManifest(dir) {
  return existsSync(join(dir, '.claude-plugin', 'marketplace.json'));
}

function readKnownMarketplaces() {
  const file = join(homedir(), '.claude', 'plugins', 'known_marketplaces.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolve the claude-kit marketplace repository root.
 * @returns {{root: string} | {error: string}}
 */
export function resolveRepoRoot() {
  const known = readKnownMarketplaces();
  const candidates = known ? getMarketplaceRootCandidates(known, MARKETPLACE_NAME) : [];

  // Fallback: running straight out of a repo checkout, two levels above the
  // plugin directory (plugins/<name> -> repo root).
  candidates.push(resolve(PLUGIN_ROOT, '..', '..'));

  for (const candidate of candidates) {
    if (candidate && hasMarketplaceManifest(candidate)) {
      return { root: candidate };
    }
  }

  return {
    error:
      'could not find the claude-kit marketplace repository. Checked ' +
      '~/.claude/plugins/known_marketplaces.json and the repo-checkout fallback, ' +
      'but none of them held a .claude-plugin/marketplace.json. ' +
      'Try `claude plugin marketplace update claude-kit`, or run this from inside ' +
      'the claude-kit repo checkout.',
  };
}

function main(argv) {
  if (argv[0] === '--root') {
    const resolved = resolveRepoRoot();
    if (resolved.error) {
      console.error(`error: ${resolved.error}`);
      return 1;
    }
    console.log(resolved.root);
    return 0;
  }

  const [scriptName, ...rest] = argv;
  if (!scriptName) {
    console.error('error: usage: node repo-script.mjs <script-name> [args...] | --root');
    return 1;
  }
  if (!SCRIPT_NAME_RE.test(scriptName)) {
    console.error(`error: "${scriptName}" is not a valid script name (expected /^[a-z0-9-]+$/, no paths)`);
    return 1;
  }

  const resolved = resolveRepoRoot();
  if (resolved.error) {
    console.error(`error: ${resolved.error}`);
    return 1;
  }

  const scriptPath = join(resolved.root, 'scripts', `${scriptName}.mjs`);
  if (!existsSync(scriptPath)) {
    console.error(`error: no such script: ${scriptPath}`);
    return 1;
  }

  const result = spawnSync(process.execPath, [scriptPath, ...rest], { stdio: 'inherit' });
  if (result.error) {
    console.error(`error: failed to run ${scriptPath}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function isMainModule() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return fileURLToPath(import.meta.url).toLowerCase() === resolve(invoked).toLowerCase();
}

if (isMainModule()) {
  process.exit(main(process.argv.slice(2)));
}
