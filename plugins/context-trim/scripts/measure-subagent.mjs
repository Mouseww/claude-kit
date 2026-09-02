#!/usr/bin/env node
// Cost measurement hook for the context-trim plugin. Single cross-platform
// implementation; requires only node.
//
// Registered on three events:
//   SubagentStart / SubagentStop  -> which agent ran, how long, what came back
//   PostToolUse (matcher: Agent)  -> REAL usage telemetry
//
// Why the third one matters. The docs state, verbatim:
//   "In PostToolUse, tool_response for a completed Agent call carries the
//    subagent's final text along with usage telemetry. Read these fields to
//    record per-subagent cost from a hook"
// So actual token usage IS reachable from a hook.
//
// Because the exact field names in that payload are version-dependent, we log
// the whole tool_response with `content` stripped out (content is the bulky
// part) instead of hand-picking fields. Whatever usage keys your version emits
// get captured, and report-metrics.mjs looks for them opportunistically.
//
// Do NOT add transcript_path parsing. The docs warn the transcript is written
// asynchronously and may lag the current turn, so it is unreliable from a hook.
//
// Purpose of all this: make the plugin's central assumption falsifiable.
// "Delegating is cheaper than reading inline" is not free -- a subagent re-pays
// its own system prompt plus the context you hand it, and the parent still pays
// for the summary coming back. For a two-file read, delegation is probably net
// negative. Without numbers you are trusting the theory.
//
// Output: ~/.claude/context-offload-metrics.jsonl (one JSON object per line)
// Report: node "<plugin dir>/scripts/report-metrics.mjs"
//
// Never blocks, never returns hook JSON, always exits 0. A failure here can
// never break a subagent or a tool call.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_DIR = path.join(os.homedir(), '.claude');
const LOG_FILE = path.join(LOG_DIR, 'context-offload-metrics.jsonl');
const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');

const PRUNE_RULES = [
  { suffix: '.tmp', ttlMs: 24 * 60 * 60 * 1000 },
  // Start markers expire faster than the session flags in the other packs: a
  // subagent that never reported its stop is stale within hours, not a day.
  { prefix: 'start-', ttlMs: 12 * 60 * 60 * 1000 },
];

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

// --- shared:quiet --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
// --- /shared:quiet ---

// --- shared:appendJsonl --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// One write call, one line, capped. An O_APPEND write is atomic only below
// PIPE_BUF (4096), so a record larger than the cap could interleave with
// another process's append and produce a line neither of them wrote. Dropping
// an oversized telemetry record is strictly better than corrupting the log,
// and parseMetricsLines in report-metrics.mjs skips whatever slips through.
const JSONL_MAX_BYTES = 4000;
function appendJsonl(file, record) {
  return (
    quiet(() => {
      const line = JSON.stringify(record) + '\n';
      if (Buffer.byteLength(line, 'utf8') > JSONL_MAX_BYTES) return false;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line);
      return true;
    }) ?? false
  );
}
// --- /shared:appendJsonl ---

// --- shared:pruneStale --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Per-rule TTLs, because a subagent start marker is stale after hours while a
// session flag is not. A rule matches on prefix, on suffix, or on both: the
// files in this directory are named both ways, `has-plan-<session>.flag` from
// the front and `<session>.streak` from the back, so prefix-only matching
// cannot express every owner. A rule with neither field is ignored rather than
// treated as a wildcard, because this directory is shared and a wildcard would
// delete other packs' state. Nothing here may throw: a hook that died during
// housekeeping would drop the work it was actually called to do.
function pruneStale(stateDir, rules) {
  quiet(() => {
    const now = Date.now();
    for (const name of fs.readdirSync(stateDir)) {
      const rule = rules.find(
        (r) =>
          (r.prefix !== undefined || r.suffix !== undefined) &&
          (r.prefix === undefined || name.startsWith(r.prefix)) &&
          (r.suffix === undefined || name.endsWith(r.suffix))
      );
      if (!rule) continue;
      const p = path.join(stateDir, name);
      quiet(() => {
        if (now - fs.statSync(p).mtimeMs > rule.ttlMs) fs.unlinkSync(p);
      });
    }
  });
}
// --- /shared:pruneStale ---

// --- shared:atomicWrite --- keep byte-identical; see tests/hook-helpers-consistent.test.mjs
// Write to a unique temp name, then rename over the target. rename is atomic
// on POSIX and near enough on NTFS, so a concurrent reader sees either the old
// bytes or the new ones, never a half-written file. Parallel Agent dispatches
// in one message run these hooks at the same time, which is when this matters.
// Windows can still return EPERM on the rename when a scanner or another
// process holds the target, so retry, then fall back to a direct write:
// a torn file is bad, but losing the state entirely is worse.
function atomicWrite(file, text) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* already there, or unwritable; the write below reports it */
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* Reached only when all three rename attempts failed and this cleanup failed
       too, which leaves one orphaned .tmp beside the target. That bound of one is
       why the name is computed once and reused across attempts rather than
       regenerated each time, which would allow up to three. Nothing here tracks
       or removes them afterwards. */
  }
  try {
    fs.writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}
// --- /shared:atomicWrite ---

function log(obj) {
  appendJsonl(LOG_FILE, obj);
}

// last_assistant_message may be a plain string or an array of content blocks.
// Measure the text either way, not the JSON literal.
function messageLength(m) {
  if (m == null) return 0;
  if (Array.isArray(m)) {
    return m
      .map((b) => (b && typeof b === 'object' ? (b.text == null ? '' : String(b.text)) : String(b)))
      .join('').length;
  }
  if (typeof m === 'object') return String(m.text ?? JSON.stringify(m)).length;
  return String(m).length;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  quiet(() => fs.mkdirSync(LOG_DIR, { recursive: true }));
  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));
  pruneStale(STATE_DIR, PRUNE_RULES);

  const event = input.hook_event_name || '';
  const session = input.session_id || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (event === 'SubagentStart' || event === 'SubagentStop') {
    const agent = input.agent_type || 'unknown';
    const agentId = input.agent_id || '';
    const effort = input.effort?.level ?? '';

    // Fall back to a per-agent-type key rather than a shared "unknown" bucket:
    // concurrent subagents with no agent_id would otherwise overwrite each
    // other's start timestamps and report nonsense durations.
    const key = agentId || `noid-${agent}`;
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const startFile = path.join(STATE_DIR, `start-${safeKey}`);

    if (event === 'SubagentStart') {
      quiet(() => atomicWrite(startFile, String(now)));
      log({ ts, event: 'start', agent, agent_id: key, session, effort });
      return;
    }

    let duration = null;
    const started = quiet(() => fs.readFileSync(startFile, 'utf8').trim());
    if (started && /^\d+$/.test(started)) duration = now - Number(started);
    quiet(() => fs.unlinkSync(startFile));

    // A real log showed 269 of 649 "stop" events arriving with no
    // agent_type, no preceding SubagentStart, returned_chars in the teens to
    // low thirties, and an effort level that reads like the MAIN thread's
    // own setting rather than a dispatched subagent's. Those are not
    // subagent completions -- what actually fires them has not been
    // established. That is exactly why this tags the record instead of
    // dropping it: report-metrics.mjs can exclude it by name rather than by
    // guessing at agent === 'unknown', and if the real source ever gets
    // found, the tag is what will make it findable in the log.
    const unattributed = !input.agent_type && duration == null;

    log({
      ts,
      event: unattributed ? 'stop_unattributed' : 'stop',
      agent,
      agent_id: key,
      session,
      effort,
      returned_chars: messageLength(input.last_assistant_message),
      duration_s: duration,
    });
    return;
  }

  if (event === 'PostToolUse') {
    // Only the Agent tool carries usage telemetry.
    if (input.tool_name !== 'Agent') return;

    const r = input.tool_response;
    let usage;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      usage = { ...r };
      delete usage.content;
    } else {
      usage = { raw: r == null ? '' : String(r) };
    }

    log({
      ts,
      event: 'agent_usage',
      session,
      subagent_type: input.tool_input?.subagent_type ?? null,
      requested_model: input.tool_input?.model ?? null,
      usage,
    });
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
