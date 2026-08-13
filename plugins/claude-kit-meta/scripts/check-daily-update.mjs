#!/usr/bin/env node
// Daily auto-update check for claude-kit marketplace plugins.
// Fires via UserPromptSubmit hook; checks at most once per calendar day.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { appendFileSync } from 'node:fs';
import { resolveMarketplaceSource, computeDirectoryFingerprint } from './marketplace-source.mjs';
import { pickExecutable, needsShell } from './resolve-command.mjs';

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

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let timer = null;
    const IDLE_MS = 5000;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve(buf), IDLE_MS);
      timer.unref();
    };
    process.stdin.setEncoding('utf8');
    resetTimer();
    process.stdin.on('data', (c) => {
      buf += c;
      resetTimer();
    });
    process.stdin.on('end', () => {
      if (timer) clearTimeout(timer);
      resolve(buf);
    });
    process.stdin.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve(buf);
    });
  });
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
    return pickExecutable(out) || name;
  } catch {
    return name;
  }
}

function readKnownMarketplaces() {
  const known = join(PLUGINS_DIR, 'known_marketplaces.json');
  if (!existsSync(known)) return null;
  try {
    return JSON.parse(readFileSync(known, 'utf8'));
  } catch (e) {
    log(`readKnownMarketplaces failed: ${e.message}`);
    return null;
  }
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

// Fingerprints a marketplace source regardless of whether it is a git
// remote or a local directory checkout.
function fingerprintSource(src) {
  if (!src) return null;
  if (src.kind === 'git') return getRemoteHead(src.url);
  if (src.kind === 'directory') return computeDirectoryFingerprint(src.path);
  return null;
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

// When resolved needs a shell (.cmd/.bat), every arg passed through here is
// either a literal defined in this file or a plugin name that has already
// been whitelisted against /^[a-zA-Z0-9_-]+$/ in getInstalledPlugins(), so
// there is no shell-injection surface from user-controlled input.
function run(cmd, args) {
  const resolved = resolveCmd(cmd);
  try {
    if (needsShell(resolved)) {
      const quotedArgs = args.map(a => `"${a}"`);
      execFileSync(`"${resolved}"`, quotedArgs, { timeout: TIMEOUT_MS, encoding: 'utf8', stdio: 'pipe', shell: true });
    } else {
      execFileSync(resolved, args, { timeout: TIMEOUT_MS, encoding: 'utf8', stdio: 'pipe' });
    }
    return true;
  } catch (e) {
    log(`run(${cmd}, ${JSON.stringify(args)}) failed: ${e.message}`);
    return false;
  }
}

function spawnUpdate(flag, todayStr, fingerprint) {
  const child = spawn(process.execPath, [import.meta.filename, '--do-update'], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      _CLAUDE_KIT_UPDATE_FINGERPRINT: fingerprint,
      _CLAUDE_KIT_UPDATE_TODAY: todayStr,
    },
  });
  child.unref();
}

async function doUpdate() {
  const todayStr = process.env._CLAUDE_KIT_UPDATE_TODAY;
  const fingerprint = process.env._CLAUDE_KIT_UPDATE_FINGERPRINT;

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

  // lastCommit now holds a git SHA or a directory fingerprint depending on
  // the marketplace source kind; the field name is kept as-is so existing
  // ~/.claude/claude-kit-update-check.json files stay valid.
  writeFlag({ lastCheck: todayStr, lastCommit: fingerprint });
  log(`update complete. updated=[${updated}] failed=[${failed}]`);
  releaseLock();
}

async function main() {
  if (process.argv.includes('--do-update')) {
    await doUpdate();
    return;
  }

  await readStdin();

  const flag = readFlag();
  const todayStr = today();

  if (flag.lastCheck === todayStr) return;

  if (!acquireLock()) return;

  const knownMarketplaces = readKnownMarketplaces();
  const src = resolveMarketplaceSource(knownMarketplaces, MARKETPLACE_NAME);
  if (!src) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  const fingerprint = fingerprintSource(src);
  if (!fingerprint) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  // lastCommit holds either a git SHA or a directory fingerprint, see doUpdate().
  if (fingerprint === flag.lastCommit) {
    writeFlag({ ...flag, lastCheck: todayStr });
    releaseLock();
    return;
  }

  spawnUpdate(flag, todayStr, fingerprint);
  output('claude-kit: checking for plugin updates in the background.');
}

main().catch(e => {
  log(`fatal: ${e.message}`);
  releaseLock();
  process.exit(0);
});
