#!/usr/bin/env node
// Daily auto-update check for claude-kit marketplace plugins.
// Fires via UserPromptSubmit hook; checks at most once per calendar day.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync } from 'node:fs';

const MARKETPLACE_NAME = 'claude-kit';
const TIMEOUT_MS = 10_000;
const CLAUDE_DIR = join(homedir(), '.claude');
const FLAG_FILE = join(CLAUDE_DIR, 'claude-kit-update-check.json');
const LOCK_FILE = join(CLAUDE_DIR, 'claude-kit-update.lock');
const LOG_FILE = join(CLAUDE_DIR, 'claude-kit-update.log');
const PLUGINS_DIR = join(CLAUDE_DIR, 'plugins');
const CACHE_DIR = join(PLUGINS_DIR, 'cache', MARKETPLACE_NAME);
const IS_WINDOWS = process.platform === 'win32';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function log(msg) {
  try {
    const ts = new Date().toISOString();
    appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  } catch { /* best effort */ }
}

function readFlag() {
  try {
    return JSON.parse(readFileSync(FLAG_FILE, 'utf8'));
  } catch {
    return { lastCheck: '', lastCommit: '' };
  }
}

function writeFlag(flag) {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  writeFileSync(FLAG_FILE, JSON.stringify(flag, null, 2) + '\n');
}

function output(text) {
  process.stdout.write(JSON.stringify({ additionalContext: text }));
}

function acquireLock() {
  try {
    const fd = openSync(LOCK_FILE, 'wx');
    closeSync(fd);
    return true;
  } catch {
    try {
      const stat = statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > 120_000) {
        unlinkSync(LOCK_FILE);
        const fd = openSync(LOCK_FILE, 'wx');
        closeSync(fd);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch { /* ignore */ }
}

function resolveCmd(name) {
  if (!IS_WINDOWS) return name;
  try {
    const out = execFileSync('where', [name], { timeout: 5000, encoding: 'utf8', stdio: 'pipe' });
    const first = out.split(/\r?\n/).find(l => l.trim());
    return first?.trim() || name;
  } catch {
    return name;
  }
}

function resolveMarketplaceUrl() {
  const known = join(PLUGINS_DIR, 'known_marketplaces.json');
  if (!existsSync(known)) return null;
  try {
    const data = JSON.parse(readFileSync(known, 'utf8'));
    for (const entry of Object.values(data)) {
      if (entry.name === MARKETPLACE_NAME || entry.repo?.endsWith(MARKETPLACE_NAME)) {
        if (entry.source === 'github') return `https://github.com/${entry.repo}.git`;
        if (entry.source === 'directory') return entry.path;
        if (entry.url) return entry.url;
      }
    }
    for (const [key, entry] of Object.entries(data)) {
      if (key.includes(MARKETPLACE_NAME) || key.endsWith(MARKETPLACE_NAME)) {
        if (entry.source === 'github') return `https://github.com/${entry.repo}.git`;
        if (entry.source === 'directory') return entry.path;
        if (entry.url) return entry.url;
      }
    }
  } catch (e) { log(`resolveMarketplaceUrl failed: ${e.message}`); }
  return null;
}

function getRemoteHead(url) {
  if (!url || !url.startsWith('http')) return null;
  try {
    const out = execFileSync('git', ['ls-remote', '--', url, 'HEAD'], { timeout: TIMEOUT_MS, encoding: 'utf8' });
    const match = out.match(/^([0-9a-f]{7,})/);
    return match ? match[1] : null;
  } catch (e) {
    log(`git ls-remote failed: ${e.message}`);
    return null;
  }
}

function getInstalledPlugins() {
  if (!existsSync(CACHE_DIR)) return [];
  try {
    return readdirSync(CACHE_DIR).filter(name => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false;
      const p = join(CACHE_DIR, name);
      return statSync(p).isDirectory();
    });
  } catch {
    return [];
  }
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function findSyncScript(pluginName) {
  const cached = join(CACHE_DIR, pluginName);
  if (!existsSync(cached)) return null;
  try {
    const versions = readdirSync(cached)
      .filter(v => statSync(join(cached, v)).isDirectory())
      .sort(compareSemver);
    if (versions.length === 0) return null;
    const latest = versions[versions.length - 1];
    const blockFile = join(cached, latest, 'claude-md-block.md');
    const syncScript = join(cached, latest, 'scripts', 'sync-claude-md.mjs');
    if (existsSync(blockFile) && existsSync(syncScript)) return syncScript;
  } catch (e) { log(`findSyncScript(${pluginName}) failed: ${e.message}`); }
  return null;
}

function run(cmd, args) {
  const resolved = resolveCmd(cmd);
  try {
    execFileSync(resolved, args, { timeout: TIMEOUT_MS, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch (e) {
    log(`run(${cmd}, ${JSON.stringify(args)}) failed: ${e.message}`);
    return false;
  }
}

function spawnUpdate(flag, todayStr, remoteHead, url) {
  const child = spawn(process.execPath, [import.meta.filename, '--do-update'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      _CLAUDE_KIT_UPDATE_REMOTE_HEAD: remoteHead,
      _CLAUDE_KIT_UPDATE_TODAY: todayStr,
    },
  });
  child.unref();
}

async function doUpdate() {
  const todayStr = process.env._CLAUDE_KIT_UPDATE_TODAY;
  const remoteHead = process.env._CLAUDE_KIT_UPDATE_REMOTE_HEAD;

  const claudeCmd = resolveCmd('claude');
  const marketplaceOk = run(claudeCmd, ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]);
  if (!marketplaceOk) {
    log('marketplace update failed');
    writeFlag({ lastCheck: todayStr, lastCommit: '' });
    releaseLock();
    return;
  }

  const plugins = getInstalledPlugins();
  const updated = [];
  const failed = [];

  for (const name of plugins) {
    if (run(claudeCmd, ['plugin', 'update', `${name}@${MARKETPLACE_NAME}`])) {
      updated.push(name);
    } else {
      failed.push(name);
    }
  }

  for (const name of updated) {
    const syncScript = findSyncScript(name);
    if (syncScript) {
      run(process.execPath, [syncScript]);
    }
  }

  writeFlag({ lastCheck: todayStr, lastCommit: remoteHead });
  log(`update complete. updated=[${updated}] failed=[${failed}]`);
  releaseLock();
}

async function main() {
  if (process.argv.includes('--do-update')) {
    await doUpdate();
    return;
  }

  let stdinData = '';
  for await (const chunk of process.stdin) stdinData += chunk;

  const flag = readFlag();
  const todayStr = today();

  if (flag.lastCheck === todayStr) return;

  if (!acquireLock()) return;

  const url = resolveMarketplaceUrl();
  if (!url) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  const remoteHead = getRemoteHead(url);
  if (!remoteHead) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  if (remoteHead === flag.lastCommit) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  spawnUpdate(flag, todayStr, remoteHead, url);
  output('claude-kit: checking for plugin updates in the background.');
}

main().catch(e => {
  log(`fatal: ${e.message}`);
  releaseLock();
  process.exit(0);
});
