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

const STALE_START_MS = 720 * 60 * 1000; // 12h, matches the old `find -mmin +720`

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

function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function log(obj) {
  quiet(() => fs.appendFileSync(LOG_FILE, JSON.stringify(obj) + '\n'));
}

// Sweep stale start-markers. A subagent that was killed, or a session that
// crashed, never fires SubagentStop, so these would accumulate forever.
function sweepStaleStarts() {
  quiet(() => {
    const cutoff = Date.now() - STALE_START_MS;
    for (const name of fs.readdirSync(STATE_DIR)) {
      if (!name.startsWith('start-')) continue;
      const p = path.join(STATE_DIR, name);
      quiet(() => {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      });
    }
  });
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
  sweepStaleStarts();

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
      quiet(() => fs.writeFileSync(startFile, String(now)));
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
