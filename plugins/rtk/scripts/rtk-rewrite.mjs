#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PreToolUse hook (matcher: Bash) for the rtk plugin. This is a thin wrapper
// around the external `rtk` binary: it hands rtk the same PreToolUse payload
// Claude Code gave us, and forwards rtk's stdout back verbatim.
//
// The one rule that matters more than any other in this file: a broken or
// missing rtk must degrade to "command runs unchanged", never to "command
// blocked". Every failure path below -- missing binary, spawn error, bad
// output, timeout -- ends the same way: exit 0, nothing on stdout. A wrapper
// that fails closed would silently brick every Bash call for anyone who
// enabled the plugin without installing rtk.
//
// Contract (verified against rtk v0.46.0 source, not re-derived here):
//   - subcommand is exactly `rtk hook claude`
//   - on a rewrite it prints one JSON object to stdout with
//     hookSpecificOutput.updatedInput.command, and permissionDecision only
//     when an explicit allow rule matched
//   - we pass that JSON through unchanged; we only check it parses, we never
//     re-shape it (no adding/stripping fields)

const TIMEOUT_MS = 5000;

// --- shared:quiet --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
// --- /shared:quiet ---

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      buf += c;
    });
    process.stdin.on('end', () => resolve(buf));
    // A stdin read error still leaves us with whatever we buffered so far;
    // downstream JSON.parse will reject a partial payload and we fail open.
    process.stdin.on('error', () => resolve(buf));
  });
}

// Dependency-free PATH probe for `rtk`. Deliberately does not shell out to
// `which`/`command -v`/`where`: those do not exist (or behave differently)
// across cmd.exe, PowerShell and POSIX shells, and spawning a shell just to
// ask "is this on PATH" adds a second process and a second failure mode for
// no benefit -- Node already has everything it needs in process.env.
// `name` must be the BARE command name, with no extension: on win32 the
// PATHEXT suffixes below are appended to it. Passing "rtk.exe" here would
// probe for "rtk.exe.EXE" and never match the real binary, which fails open
// so quietly that the plugin looks installed-but-inert on every Windows box.
export function findOnPath(name, env = process.env, platform = process.platform) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  // The leading '' is what matches a binary the user saved as `rtk.exe` when
  // we probe for `rtk` + '.EXE', *and* a bare extensionless `rtk` dropped on
  // a Windows PATH by WSL-ish tooling. Non-win32 only ever needs ''.
  const exts =
    platform === 'win32'
      ? ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(path.delimiter).filter(Boolean)]
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (quiet(() => fs.statSync(candidate).isFile())) return candidate;
    }
  }
  return null;
}

// Runs `rtk hook claude`, feeding it `stdinPayload` and collecting stdout.
// Resolves to the collected stdout string on a clean exit, or null on any
// failure (non-zero exit, spawn error, timeout). Never rejects: every path
// the caller needs to fail open on is expressed as a null resolve.
function runRtk(binary, stdinPayload) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binary, ['hook', 'claude'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      // Synchronous spawn failure (rare, but possible on some platforms).
      resolve(null);
      return;
    }

    let out = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    // The wrapper's own timeout must be shorter than the 10s hooks.json gives
    // the whole hook, so we are the ones who give up cleanly instead of the
    // harness killing us mid-write with an ambiguous outcome.
    const timer = setTimeout(() => {
      quiet(() => child.kill());
      finish(null);
    }, TIMEOUT_MS);
    timer.unref();

    child.on('error', () => finish(null));
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.on('close', (code) => {
      finish(code === 0 ? out : null);
    });

    child.stdin.on('error', () => {
      // Writing to a child that has already exited (e.g. it rejected the
      // input immediately) throws EPIPE here; the 'close' handler above is
      // still the source of truth for the outcome.
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

async function main() {
  const raw = await readStdin();

  // Escape hatch: unconditional and checked before anything else touches the
  // filesystem or spawns a process, so it also works as an instant kill
  // switch if rtk itself is misbehaving.
  if (process.env.CLAUDE_KIT_RTK_OFF) return;

  // Bare name on both platforms; findOnPath appends PATHEXT itself on win32.
  const binary = findOnPath('rtk');
  if (!binary) {
    // Missing rtk is the expected state for anyone who enabled the plugin
    // but hasn't installed the binary yet. No stderr here on purpose: this
    // hook fires on every Bash call, so a per-call warning would be far
    // noisier than the feature simply being off.
    return;
  }

  const stdout = await runRtk(binary, raw);
  if (stdout == null) return;

  // Only validate that rtk's output is parseable JSON. We never re-serialize
  // or reshape it -- any successful parse means the original string is
  // passed through byte-for-byte, so rtk's own field choices (including
  // whether permissionDecision is present) survive untouched.
  const parsed = quiet(() => JSON.parse(stdout));
  if (parsed === undefined) return;

  process.stdout.write(stdout);
}

// Only run when executed as the hook entry point. Without this guard, the
// unit test that imports findOnPath would also start main(), which blocks
// forever waiting on a stdin that never arrives.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch(() => process.exit(0));
}
