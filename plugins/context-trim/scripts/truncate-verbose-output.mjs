#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// PostToolUse hook (matcher: Bash|PowerShell|mcp__workspace__bash) for the
// context-trim plugin. The MCP entry is Cowork's shell tool; its response shape
// differs (content blocks, not stdout/stderr) and is handled below.
//
// Single cross-platform implementation. Requires only node (no jq, no awk).
// Ported 1:1 from the previous bash/PowerShell pair; the algorithm, tunables
// and invariants are unchanged.
//
// Shrinks noisy command output before it enters the model's context.
//
// ============================================================================
// IMPORTANT, READ BEFORE TRUSTING THIS HOOK: the shape of updatedToolOutput
// ============================================================================
// The Claude Code docs say updatedToolOutput "replaces the tool's result" and
// "works for any tool", but do not clearly state whether the replacement must
// match the tool's own output shape. For Bash, tool_response is an OBJECT
// (stdout, stderr, interrupted, isImage), not a string. If Claude Code
// validates the shape, a plain string is silently discarded and the original
// untruncated output is used -- the hook becomes a no-op and you would never
// notice, because the script's own stdout looks fine.
//
// So: OUTPUT_SHAPE below is a one-line switch, defaulting to the object form
// (the conservative reading -- it matches the documented tool_response schema).
// Verify which one your Claude Code version accepts, it takes 30 seconds:
//
//   1. Run a command with long clean output, e.g.  seq 1 5000
//   2. If the result you see starts with "[context-trim: ...]", the hook works.
//      If you see all 5000 lines, it is being discarded.
//   3. If discarded, set OUTPUT_SHAPE = 'string' below and repeat step 1.
//
// ============================================================================
// Why failure output and clean output get different thresholds
// ============================================================================
// Truncation is not free. When the slice drops the part the agent actually
// wanted, the agent reruns the command, and that costs the wasted slice (which
// stays in context forever), a fresh tool call, and the new output. Writing N
// for the original size, K for the ~4700 chars any slice keeps, and p for the
// probability of a rerun, truncation is a net loss when
//
//     p > (N - K) / (N + K)
//
// N=6000 loses at a 12% rerun rate. N=30000 needs 73%. So the break-even rate
// RISES with N, while the real rerun rate FALLS with N: the middle of a huge
// log is usually noise, the middle of an 8k result is usually the answer.
// Below the crossover, truncating loses money.
//
// The two modes sit on opposite sides of it:
//   - Failure output: the agent wanted a verdict. The useful content really is
//     clustered around the keywords and the tail, and once it has the verdict
//     it goes to the source rather than rerunning. Low p, so cut early (6000).
//   - Clean output: the agent ran the command to GET the content, so the value
//     is spread through it and the middle is often exactly what was asked for.
//     High p, so only cut once N is large enough to survive a bad guess. 30000
//     is where even a 70% rerun rate still breaks even.
//
// Measured over 329 real invocations before this split: the failure path
// produced 76% of all savings from 74% of the truncations, while the clean
// path fired 5 times for ~6.6k tokens total and paid for every rerun it caused.
//
// What replaces clean-mode truncation is the followup tip further down. For a
// large clean result the hook now leaves the output intact and attaches the
// "use Read/Grep instead" advice as additionalContext, which changes the NEXT
// command instead of damaging this one.
//
// ============================================================================
// Design notes: four bugs measured in v1, all fixed here and preserved in this
// port.
//   1. Budgets are in CHARACTERS, not lines. Line-based head/tail saved almost
//      nothing on long-line output (tsc/vite/docker logs, single-line JSON).
//   2. If head and tail slices would touch or overlap, fall back to
//      character-level slicing. v1 emitted both, which DUPLICATED the output
//      for anything under ~160 lines (40k single-line payload came back 80k).
//   3. Failure detection strips known false positives ("0 errors", "no errors",
//      "npm warn") first. v1 treated a clean build printing "Found 0 errors" as
//      a failure and cut it to 240 chars.
//   4. The failure branch always keeps the LAST N lines. v1 kept only the
//      earliest matches, losing the "X failed" summary.
//
// Four invariants. Do not remove them regardless of how the algorithm changes:
//   A. If the replacement is not meaningfully shorter, emit nothing. A
//      truncation hook must never make context bigger.
//   B. If the body came back empty, emit nothing. Otherwise we would replace
//      the entire tool output with a one-line header and silently destroy it.
//   C. The notice must describe the path actually taken, not the path intended.
//   D. Never character-slice a structured payload. Half a JSON document neither
//      parses nor answers the question, so the rerun rate is close to 1 and the
//      inequality above can never come out in our favour.

// ---- tunables --------------------------------------------------------------
const OUTPUT_SHAPE = 'object'; // 'object' (Bash tool_response shape) or 'string'
const MAX_CHARS_FAILURE = 6000; // failure output: below this, pass through untouched
const MAX_CHARS_CLEAN = 30000; // clean output: below this, pass through untouched
const ADVICE_MIN_CHARS = 6000; // above this, untruncated output still gets a narrowing tip
const HEAD_BUDGET = 2000; // chars kept from the start (clean output)
const TAIL_BUDGET = 2500; // chars kept from the end (clean output)
const ERR_BUDGET = 3000; // chars kept for keyword context (failure output)
const TAIL_KEEP_LINES = 25; // lines kept from the end (failure output), capped by:
const TAIL_KEEP_CHARS = 2500; // ...this char cap, so a few very long lines cannot blow up
const MIN_SAVING_PCT = 20; // only replace if we save at least this much
// -----------------------------------------------------------------------------

// Cheapest gate that can still be wrong in our favour: below this nothing can
// happen, so we skip mode detection entirely. Derived, never set by hand.
const MAX_CHARS_MIN = Math.min(MAX_CHARS_FAILURE, MAX_CHARS_CLEAN, ADVICE_MIN_CHARS);

// ---- telemetry --------------------------------------------------------------
// Best-effort, fail-open logging into the same file measure-subagent.mjs
// already writes to (~/.claude/context-offload-metrics.jsonl), tagged with
// event: 'truncate'. This is purely observational: it must never influence
// truncation behaviour, and any failure here is swallowed so it can never
// affect the hook's own exit code or output.
//
// The destination is overridable via CONTEXT_TRIM_METRICS_FILE so tests can
// point it at a scratch file instead of the user's real metrics log.
const LOG_FILE =
  process.env.CONTEXT_TRIM_METRICS_FILE || path.join(os.homedir(), '.claude', 'context-offload-metrics.jsonl');

function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// Heuristic, NOT reliable JSON detection: a log line like "[2026-08-13] build
// started" false-positives here. It has exactly two permitted uses.
//
//   1. Telemetry aggregation, as before.
//   2. Invariant D: suppressing the character-slice path.
//
// Use 2 is safe despite the weak heuristic, because of WHERE it is consulted.
// Character mode is only reached when the payload has too few line breaks to
// slice by line, and the classic false positive is a LOG LINE -- a log has line
// breaks, so it never reaches that decision. Getting it wrong in the remaining
// cases costs a missed saving (a large blob passes through intact); getting the
// opposite wrong would cut a JSON document in half. Prefer the missed saving.
//
// Still never write it into a user-visible notice: a wrong claim about the
// payload's format is worse than no claim.
function looksStructured(s) {
  const t = s.trimStart();
  return t.length > 0 && (t[0] === '{' || t[0] === '[');
}

function emitTelemetry({ toolName, sessionId, path: takenPath, origLen, finalLen, errCut, errLinesOmitted, source }) {
  quiet(() => {
    const entry = {
      ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      event: 'truncate',
      session: sessionId || 'unknown',
      tool: toolName,
      path: takenPath,
      orig_chars: origLen,
      final_chars: finalLen,
      err_cut: Boolean(errCut),
      err_lines_omitted: errLinesOmitted || 0,
      looks_structured: looksStructured(source),
    };
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  });
}

// Guard on the tool name as well as the hooks.json matcher. Defence in depth:
// without this, registering the hook under a wider matcher would silently start
// truncating Read/Grep results too. Keep in sync with the matcher in hooks.json.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'mcp__workspace__bash']);

const FAILURE_RE = /error|fatal|exception|traceback|panic|fail/;

// Phrases that look like failures but are not. Stripped before the keyword scan.
const FALSE_POSITIVES = [
  /0 errors?/g,
  /no errors?/g,
  /zero errors?/g,
  /0 failures?/g,
  /no failures?/g,
  /0 failed/g,
  /0 problems?/g,
  /error-free/g,
  /without error/g,
  /npm warn/g,
  /errors: 0/g,
  /failures: 0/g,
];

// Idle timeout, not an absolute one: an absolute cutoff would truncate a large
// but still-flowing Bash payload mid-stream. Every chunk resets the timer;
// only 5s with no data AND no `end` resolves the buffer collected so far. A
// partial buffer that fails downstream JSON.parse falls through the existing
// fail-open path.
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

// Command substitution in the shell original stripped trailing newlines. Keep
// the same behaviour so the emitted body is byte-identical to the bash version.
function stripTrailingNewlines(s) {
  return s.replace(/\n+$/, '');
}

function splitLines(s) {
  const parts = s.split('\n');
  // awk does not produce a final empty record for a trailing newline.
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function charModeBody(combined) {
  const origLen = combined.length;
  let hb = HEAD_BUDGET;
  let tb = TAIL_BUDGET;
  // Guard: shrink the budgets rather than let head+tail cover the whole string.
  if (origLen < hb + tb + 64) {
    hb = Math.max(1, Math.floor(origLen / 3));
    tb = Math.max(1, Math.floor(origLen / 3));
  }
  const head = combined.slice(0, hb);
  const tail = combined.slice(combined.length - tb);
  return `${head}\n\n...[${origLen - hb - tb} chars omitted]...\n\n${tail}`;
}

// Returns { path: 'clean'|'error'|'char', body, errCut, errLinesOmitted } or
// null when the slice cannot be built. 'char' means line-based slicing could
// not save anything. errCut/errLinesOmitted are only meaningful for the
// 'error' path (whether the matching-line budget forced a cut, and how many
// matched lines that cost); they are false/0 for the other two paths.
//
// allowChar=false (Invariant D) turns every character-slice fallback into a
// null return, which the caller treats as "pass the output through untouched".
function buildBody(combined, mode, allowChar) {
  const charFallback = () =>
    allowChar ? { path: 'char', body: charModeBody(combined), errCut: false, errLinesOmitted: 0 } : null;

  const L = splitLines(combined);
  const n = L.length;
  if (n === 0) return charFallback();

  const cost = (i) => L[i - 1].length + 1; // 1-indexed, matching the awk original

  if (mode === 'clean') {
    let acc = 0;
    let h = 0;
    for (let i = 1; i <= n; i++) {
      const c = cost(i);
      if (h > 0 && acc + c > HEAD_BUDGET) break;
      acc += c;
      h = i;
    }
    acc = 0;
    let t = n + 1;
    for (let i = n; i >= 1; i--) {
      const c = cost(i);
      if (t <= n && acc + c > TAIL_BUDGET) break;
      acc += c;
      t = i;
    }
    if (h >= t - 1) return charFallback();

    let omit = 0;
    for (let i = h + 1; i <= t - 1; i++) omit += cost(i);

    const out = [];
    for (let i = 1; i <= h; i++) out.push(L[i - 1] + '\n');
    out.push(`\n...[${t - h - 1} lines / ${omit} chars omitted]...\n\n`);
    for (let i = t; i <= n; i++) out.push(L[i - 1] + '\n');
    return { path: 'clean', body: stripTrailingNewlines(out.join('')), errCut: false, errLinesOmitted: 0 };
  }

  // ---- failure mode ----
  // Reserve the forced tail first so the run summary always survives, but cap
  // it by CHARACTERS as well as lines: 25 very long lines could otherwise
  // produce a 75k "truncated" result.
  let tlo = Math.max(1, n - TAIL_KEEP_LINES + 1);
  let tailcost = 0;
  for (let i = n; i >= tlo; i--) {
    const c = cost(i);
    if (tailcost + c > TAIL_KEEP_CHARS && i < n) {
      tlo = i + 1;
      break;
    }
    tailcost += c;
  }

  // If the forced tail alone is already most of the input, line mode is
  // pointless: fall back to a character slice.
  if (tlo <= 1) return charFallback();

  const budget = Math.max(600, ERR_BUDGET - tailcost);

  const mark = new Set();
  for (let i = 1; i <= n; i++) {
    if (FAILURE_RE.test(L[i - 1].toLowerCase())) {
      const lo = Math.max(1, i - 2);
      const hi = Math.min(n, i + 6);
      for (let j = lo; j <= hi; j++) mark.add(j);
    }
  }

  // Total matched lines/chars before the forced tail, computed up front so
  // the omission markers below can report exactly how much was cut instead
  // of just "some".
  let markedTotal = 0;
  let markedTotalChars = 0;
  for (let i = 1; i < tlo; i++) {
    if (mark.has(i)) {
      markedTotal++;
      markedTotalChars += cost(i);
    }
  }

  const out = [];
  let acc = 0;
  let last = 0;
  let shown = 0;
  let cut = false;
  for (let i = 1; i < tlo; i++) {
    if (!mark.has(i)) continue;
    const c = cost(i);
    if (acc + c > budget) {
      cut = true;
      break;
    }
    // Gap between two non-adjacent matched blocks: quantify what sits
    // between them, same convention as the clean-mode omission marker.
    if (last && i > last + 1) {
      let gapChars = 0;
      for (let j = last + 1; j < i; j++) gapChars += cost(j);
      out.push(`...[${i - last - 1} lines / ${gapChars} chars omitted]...\n`);
    }
    out.push(L[i - 1] + '\n');
    acc += c;
    last = i;
    shown++;
  }
  const errLinesOmitted = cut ? markedTotal - shown : 0;
  const errCharsOmitted = cut ? markedTotalChars - acc : 0;
  if (cut) out.push(`...[${errLinesOmitted} lines / ${errCharsOmitted} chars omitted]...\n`);
  // Gap between the last shown matched line and the forced tail.
  if (shown && tlo > last + 1) {
    let gapChars = 0;
    for (let j = last + 1; j < tlo; j++) gapChars += cost(j);
    out.push(`...[${tlo - last - 1} lines / ${gapChars} chars omitted]...\n`);
  }
  for (let i = tlo; i <= n; i++) out.push(L[i - 1] + '\n');
  return { path: 'error', body: stripTrailingNewlines(out.join('')), errCut: cut, errLinesOmitted };
}

// Invariant C: the notice describes the path actually taken.
function makeNotice(path, origLen) {
  switch (path) {
    case 'clean':
      return `[context-trim: ${origLen} chars, truncated head/tail by char budget, no failure keywords found]`;
    case 'error':
      return `[context-trim: ${origLen} chars, looks like a failure, kept error context plus the tail]`;
    default:
      return `[context-trim: ${origLen} chars, too few line breaks to slice by line, cut by character position instead]`;
  }
}

// The advice-only notice, for output we deliberately left whole. It must not
// claim anything was removed, or the model will try to recover content that is
// still right there in front of it.
function makeAdvice(origLen, followup) {
  return `[context-trim: ${origLen} chars, left intact.${followup}]`;
}

function writeHookOutput(fields) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', ...fields },
    }) + '\n'
  );
}

// ---- actionable-followup detection -----------------------------------------
// This hook is the one place in the whole system that knows FOR CERTAIN that
// content was just lost (not merely predicted ahead of time), so its notice
// is the only spot where a followup suggestion carries zero false-positive
// risk. Only fires for commands that are clearly aimed at retrieving content;
// everything else (build/test/install commands) gets no suggestion at all.
// String/regex matching only, deliberately no shell parsing: prefer a missed
// match (no suggestion) over a wrong one.

// Splits a shell command line into simple pipeline segments and returns the
// first word of each segment, lowercased. Good enough to catch "cat foo.txt"
// or "kubectl logs pod | grep x" without parsing quoting/subshells.
function commandSegments(command) {
  return command
    .split(/[\r\n]+/)
    .flatMap((line) => line.split(/(?:&&|\|\||[|;])/))
    .map((seg) => seg.trim())
    .filter(Boolean);
}

function firstWord(segment) {
  return (segment.split(/\s+/)[0] || '').toLowerCase();
}

const READ_FILE_CMDS = new Set(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'nl', 'strings']);
const SEARCH_CMDS = new Set(['grep', 'rg', 'egrep', 'fgrep', 'ag', 'ack', 'findstr', 'select-string']);
const WEB_FETCH_CMDS = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr']);
const GIT_NARROW_SUBCMDS = new Set(['show', 'diff', 'log', 'blame', 'cat-file']);

const READ_FILE_TIP = ' Next time, use the Read tool instead (add offset/limit for a slice).';
const SEARCH_TIP = ' Next time, use the Grep tool instead (set head_limit and output_mode).';
const LIST_DIR_TIP = ' Next time, use the Glob tool instead.';
const WEB_FETCH_TIP = ' Next time, use the WebFetch tool instead.';
const GIT_NARROW_TIP = ' Rerun narrower next time: add --stat, --name-only, -- <path>, or -n <num>.';
const LOGS_NARROW_TIP = ' Rerun narrower next time: add --tail=N, -n N, a SQL LIMIT, or a specific jq filter.';

function classifyCommand(command) {
  if (!command) return null;
  for (const segment of commandSegments(command)) {
    const w0 = firstWord(segment);

    if (READ_FILE_CMDS.has(w0)) return READ_FILE_TIP;
    if (SEARCH_CMDS.has(w0)) return SEARCH_TIP;
    if (WEB_FETCH_CMDS.has(w0)) return WEB_FETCH_TIP;

    if (w0 === 'find' || w0 === 'tree') return LIST_DIR_TIP;
    if (w0 === 'ls' && /\s-\w*r\w*\b/i.test(segment)) return LIST_DIR_TIP;
    if (w0 === 'dir' && /\/s\b/i.test(segment)) return LIST_DIR_TIP;
    if (w0 === 'get-childitem' && /-recurse\b/i.test(segment)) return LIST_DIR_TIP;

    if (w0 === 'git') {
      const sub = (segment.split(/\s+/)[1] || '').toLowerCase();
      if (GIT_NARROW_SUBCMDS.has(sub)) return GIT_NARROW_TIP;
    }
    if ((w0 === 'docker' || w0 === 'kubectl') && /^\S+\s+logs\b/i.test(segment)) return LOGS_NARROW_TIP;
    if (w0 === 'journalctl') return LOGS_NARROW_TIP;
    if (w0 === 'psql' && /\s-c\b/.test(segment)) return LOGS_NARROW_TIP;
    if (w0 === 'jq' && /^jq\s*(--?\S+\s*)*$/i.test(segment)) return LOGS_NARROW_TIP;
  }
  return null;
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // unparseable payload: never touch the tool result
  }

  if (!SHELL_TOOLS.has(input.tool_name)) return;

  // ---- input shape detection ----------------------------------------------
  // Claude Code's own shell tool returns an object with stdout/stderr. An MCP
  // shell tool (Cowork's mcp__workspace__bash, and MCP tools generally) returns
  // {content:[{type:"text",text:...}]} instead. We read both and echo back in
  // whichever shape came in, so the replacement matches the tool's schema.
  // Anything unrecognized exits without output rather than guessing.
  const r = input.tool_response;
  let kind;
  let combined;
  if (typeof r === 'string') {
    kind = 'plain';
    combined = r;
  } else if (r && typeof r === 'object' && !Array.isArray(r)) {
    if ('stdout' in r || 'stderr' in r) {
      kind = 'native';
      const stdout = r.stdout == null ? '' : String(r.stdout);
      const stderr = r.stderr == null ? '' : String(r.stderr);
      combined = stderr ? `${stdout}\n${stderr}` : stdout;
    } else if (Array.isArray(r.content)) {
      kind = 'mcp';
      combined = r.content
        .map((b) => (b && typeof b === 'object' ? (b.text == null ? '' : String(b.text)) : String(b)))
        .join('\n');
    } else {
      return;
    }
  } else {
    return;
  }

  // Every "leave the output alone" exit goes through here so the metrics log
  // records one entry per invocation no matter which branch we took.
  const passthrough = (len, extra) =>
    emitTelemetry({
      toolName: input.tool_name,
      sessionId: input.session_id,
      path: 'passthrough',
      origLen: len,
      finalLen: len,
      errCut: false,
      errLinesOmitted: 0,
      source: combined,
      ...extra,
    });

  if (combined.length <= MAX_CHARS_MIN) {
    passthrough(combined.length);
    return;
  }

  // Normalize CRLF so line handling behaves the same on every platform, then
  // re-check the threshold: a CRLF-heavy payload can drop below the gate here,
  // and truncating it would throw away hundreds of lines to save a few bytes.
  combined = combined.replace(/\r\n/g, '\n');
  const origLen = combined.length;
  if (origLen <= MAX_CHARS_MIN) {
    passthrough(origLen);
    return;
  }

  // ---- failure detection --------------------------------------------------
  let cleaned = combined.toLowerCase();
  for (const re of FALSE_POSITIVES) cleaned = cleaned.replace(re, '');
  const mode = FAILURE_RE.test(cleaned) ? 'error' : 'clean';

  // The followup suggestion is computed before the threshold check because it
  // is now useful on both sides of it: appended to the notice when we truncate,
  // and emitted on its own when we deliberately do not. Where it does go into
  // a notice it is folded into every length check below, so it counts against
  // Invariant A's saving floor the same as the rest of the notice: a suggestion
  // can never push a would-have-passed-through case into being replaced.
  const commandText = String(
    (input.tool_input && typeof input.tool_input === 'object' && (input.tool_input.command || input.tool_input.script)) || ''
  );
  const followup = classifyCommand(commandText) || '';

  // Per-mode threshold. See the header note on why clean output is left alone
  // until it is five times larger than failure output.
  const cutAbove = mode === 'error' ? MAX_CHARS_FAILURE : MAX_CHARS_CLEAN;
  if (origLen <= cutAbove) {
    // Large enough to be worth narrowing next time, but not large enough that
    // cutting it now would pay for itself. Hand back the advice and nothing
    // else: the tool output reaches the model complete.
    if (followup && origLen > ADVICE_MIN_CHARS) {
      emitTelemetry({
        toolName: input.tool_name,
        sessionId: input.session_id,
        path: 'advice',
        origLen,
        finalLen: origLen,
        errCut: false,
        errLinesOmitted: 0,
        source: combined,
      });
      writeHookOutput({ additionalContext: makeAdvice(origLen, followup) });
      return;
    }
    passthrough(origLen);
    return;
  }

  // Invariant D: a structured payload must never be cut at a character offset.
  const allowChar = !looksStructured(combined);

  const built = buildBody(combined, mode, allowChar);
  // Invariant B: never proceed on an empty body. Also the landing point for a
  // char-slice suppressed by Invariant D.
  if (!built || !built.body) {
    passthrough(origLen);
    return;
  }

  let { path, body } = built;

  let summary = `${makeNotice(path, origLen)}${followup}\n${body}`;

  // If line mode could not shrink it, try the character slice before giving up.
  if (summary.length >= origLen && path !== 'char') {
    if (!allowChar) {
      passthrough(origLen, { errCut: built.errCut, errLinesOmitted: built.errLinesOmitted });
      return;
    }
    path = 'char';
    body = charModeBody(combined);
    summary = `${makeNotice(path, origLen)}${followup}\n${body}`;
  }

  // Invariant A: require a meaningful saving, not just any saving. Without the
  // percentage floor we would happily drop 600 lines to save 19 characters.
  // Checked against the full summary (notice + followup + body) so the
  // followup text cannot sneak a case past the floor.
  const savingFloor = origLen - Math.floor((origLen * MIN_SAVING_PCT) / 100);
  if (summary.length >= savingFloor) {
    passthrough(origLen, { errCut: built.errCut, errLinesOmitted: built.errLinesOmitted });
    return;
  }

  // Echo back in the same shape we received, by cloning the original
  // tool_response and swapping only the text. That preserves interrupted,
  // isImage, isError and anything else this Claude Code version happens to
  // send, without this script needing to know the full schema.
  let updated;
  if (OUTPUT_SHAPE === 'string' || kind === 'plain') {
    updated = summary;
  } else if (kind === 'mcp') {
    updated = { ...r, content: [{ type: 'text', text: summary }] };
  } else {
    updated = { ...r, stdout: summary, stderr: '' };
  }

  emitTelemetry({
    toolName: input.tool_name,
    sessionId: input.session_id,
    path,
    origLen,
    finalLen: summary.length,
    errCut: built.errCut,
    errLinesOmitted: built.errLinesOmitted,
    source: combined,
  });

  writeHookOutput({ updatedToolOutput: updated });
}

main().catch(() => process.exit(0));
