// Pure helpers for resolving a marketplace entry from known_marketplaces.json
// and fingerprinting a local directory-source marketplace's installed plugin
// versions.
//
// Split out from check-daily-update.mjs so tests can import these functions
// directly: that script's main() has top-level side effects (stdin read,
// process exit), so it cannot be imported the way this module can (see
// scripts/agent-nesting-rules.mjs at the repo root for the sibling pattern).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Normalize one known_marketplaces.json entry into { source, repo, path } and
 * decide whether it matches the requested marketplace name.
 */
function normalizeEntry(entry) {
  if (entry.source && typeof entry.source === 'object') {
    return entry.source;
  }
  if (typeof entry.source === 'string') {
    return { source: entry.source, repo: entry.repo, path: entry.path };
  }
  return {};
}

function entryMatchesName(key, entry, name) {
  if (key === name) return true;
  if (entry.name === name) return true;
  const repo = entry.source && typeof entry.source === 'object' ? entry.source.repo : entry.repo;
  if (repo && (repo === name || repo.endsWith(`/${name}`))) return true;
  return false;
}

/**
 * @param {object} data parsed known_marketplaces.json contents
 * @param {string} name marketplace name, e.g. 'claude-kit'
 * @returns {{kind:'git', url:string} | {kind:'directory', path:string} | null}
 */
export function resolveMarketplaceSource(data, name) {
  if (!data || typeof data !== 'object') return null;

  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') continue;
    if (!entryMatchesName(key, entry, name)) continue;

    const src = normalizeEntry(entry);

    if (src.source === 'github' && src.repo) {
      return { kind: 'git', url: `https://github.com/${src.repo}.git` };
    }
    const dirPath = src.path || entry.installLocation;
    if (src.source === 'directory' && dirPath) {
      return { kind: 'directory', path: dirPath };
    }
    if (src.url) {
      return { kind: 'git', url: src.url };
    }
    // No usable shape on this entry; keep scanning the rest.
  }

  return null;
}

/** Read `<pluginDir>/.claude-plugin/plugin.json` and return its version, or 'unknown'. */
function readPluginVersion(pluginDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * @param {string} dirPath local marketplace repo root
 * @returns {string|null} sha1 hex fingerprint of installed plugin versions, or null
 */
export function computeDirectoryFingerprint(dirPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dirPath, '.claude-plugin', 'marketplace.json'), 'utf8'));
  } catch {
    return null;
  }

  if (!Array.isArray(manifest.plugins)) return null;

  const entries = manifest.plugins.map((p) => {
    const pluginDir = typeof p.source === 'string' ? join(dirPath, p.source) : join(dirPath, 'plugins', p.name);
    const version = readPluginVersion(pluginDir);
    return `${p.name}@${version}`;
  });

  const fingerprint = entries.sort().join('\n');
  return createHash('sha1').update(fingerprint).digest('hex');
}
