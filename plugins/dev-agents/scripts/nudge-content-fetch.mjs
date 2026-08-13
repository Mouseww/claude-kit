#!/usr/bin/env node
// PreToolUse hook (matcher: Bash|PowerShell) for the dev-agents plugin.
//
// context-trim's truncate-verbose-output.mjs silently drops the middle of any
// Bash/PowerShell output over 6000 characters (clean mode keeps only the first
// 2000 and last 2500 chars). A command run to FETCH content -- read a file,
// search text, list a tree, fetch a URL, dump git/log content -- routinely
// produces output that size, and the loss is invisible: the model never sees
// a truncation notice for the part that mattered.
//
// This is a reminder, not a block. It never denies the tool call, and it never
// touches command output; it only reads tool_input.command before the command
// runs.
//
// Two different reminder shapes, deliberately not merged:
//
//   1. Tool-precedence categories (read-file, search, list-files, web-fetch):
//      a dedicated tool already does this without a shell, so the reminder
//      says "use that tool instead".
//   2. Narrow-at-source categories (git-content, log-query): no dedicated tool
//      replaces `git diff` or `docker logs`, so the reminder says "narrow the
//      command itself" (--stat, --tail, LIMIT, etc.), never "switch tools".
//
// Exemptions are deliberately permissive: this hook would rather miss a real
// case than nag a command that is already narrowed, piped into a narrowing
// command, redirected to a file, or a heredoc write. When in doubt, stay
// silent.
//
// Fail-open throughout: any parse error or unexpected shape exits 0 with no
// output.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = path.join(os.tmpdir(), 'claude-context-offload');
const FLAG_PREFIX = 'content-fetch-warned-';

const TRUNCATION_WHY =
  'truncation kicks in past 6000 characters, and clean mode keeps only the first 2000 and last ' +
  '2500 characters, so a large result silently loses most of its middle.';

// ---- shared shell-level exemptions ------------------------------------------
// Any one of these being true means the command is already narrowed (or is a
// write, not a read), so no category fires at all.

// Heredoc write: `cat <<EOF ... EOF` writes a file, it does not read one.
const HEREDOC_WRITE = /<<-?\s*['"]?[A-Za-z_]/;

// Output redirected to a file: nothing comes back into context to truncate.
const REDIRECTED =
  /(?<!\d)>{1,2}(?!&)|\|\s*(Out-File|Set-Content|Add-Content|Tee-Object)\b/i;

// Piped into a command that itself narrows the result before it reaches
// context: head/tail/wc/jq <filter>/Select-Object -First|-Last/grep family.
function pipedIntoNarrowing(cmd) {
  const parts = cmd.split(/\|(?!\|)/);
  if (parts.length < 2) return false;
  const dest = parts[parts.length - 1].trim();
  return /^(head|tail|wc|less|more)\b/i.test(dest)
    || /^Measure-Object\b/i.test(dest)
    || /^jq\b\s*\S/i.test(dest)
    || /^Select-Object\b[^|]*-(First|Last)\b/i.test(dest)
    || /^(grep|egrep|fgrep|rg|ag|ack|findstr|Select-String)\b/i.test(dest);
}

// Flags that already bound the command's own output, safe to check globally
// because none of them is itself a category-triggering token.
const SELF_LIMITED =
  /(-n\s*\d+|--max-count(=|\s)|--tail(=|\s)?\d*|--stat\b|--name-only\b|--oneline\b|--shortstat\b|(?:^|\s)-1(?:\s|$)|--quiet\b|\bLIMIT\s+\d+\b)/i;

// `git log -p -- <path>`: -p combined with an explicit path restriction.
const GIT_NARROWED_WITH_PATH = /-p\b[\s\S]*?--\s+\S/;

function isExempt(cmd) {
  if (HEREDOC_WRITE.test(cmd)) return true;
  if (REDIRECTED.test(cmd)) return true;
  if (pipedIntoNarrowing(cmd)) return true;
  if (SELF_LIMITED.test(cmd)) return true;
  if (GIT_NARROWED_WITH_PATH.test(cmd)) return true;
  return false;
}

// grep-family flags that mean "I already narrowed this": -q/-l/-c. Checked
// only for the search category, because psql's own -c is a trigger, not an
// exemption, and would otherwise be swallowed by a blanket global check.
const SEARCH_SELF_LIMITED = /(?:^|\s)-q\b|(?:^|\s)-l\b|(?:^|\s)-c\b/;

function firstPipelineSegment(cmd) {
  return cmd.split(/\|(?!\|)/)[0];
}

// ---- category detectors -----------------------------------------------------
// Each returns the matched snippet (for echoing back in the reminder) or null.
// Checked against the first pipeline segment: the command that actually reads
// the file/network/log, not whatever it is piped into.

function detectReadFile(seg) {
  const m = /(?:^|[;&]|\n)\s*(cat|type|head|tail|less|more|nl|strings|gc|Get-Content)\b/i.exec(seg);
  if (m) return m[1];
  if (/\bsed\s+-n\b/i.test(seg)) return 'sed -n';
  return null;
}

function detectSearch(seg) {
  if (SEARCH_SELF_LIMITED.test(seg)) return null;
  const m = /(?:^|[;&]|\n)\s*(grep|egrep|fgrep|rg|ag|ack|findstr|Select-String)\b/i.exec(seg);
  return m ? m[1] : null;
}

function detectListFiles(seg) {
  if (/\bls\b[^|]*-[a-zA-Z]*R\b/.test(seg)) return 'ls -R';
  if (/(?:^|[;&]|\n)\s*find\b/i.test(seg)) return 'find';
  if (/(?:^|[;&]|\n)\s*tree\b/i.test(seg)) return 'tree';
  if (/\bdir\b[^|]*\/s\b/i.test(seg)) return 'dir /s';
  if (/\b(Get-ChildItem|gci|dir)\b[^|]*-Recurse\b/i.test(seg)) return 'Get-ChildItem -Recurse';
  return null;
}

function detectWebFetch(seg) {
  const m = /(?:^|[;&]|\n)\s*(curl|wget|Invoke-WebRequest|iwr)\b/i.exec(seg);
  return m ? m[1] : null;
}

function detectGitContent(seg) {
  if (!/\bgit\b/i.test(seg)) return null;
  if (/\bgit\s+show\b/i.test(seg)) return 'git show';
  if (/\bgit\s+diff\b/i.test(seg)) return 'git diff';
  if (/\bgit\s+log\b[^|]*-p\b/i.test(seg)) return 'git log -p';
  if (/\bgit\s+blame\b/i.test(seg)) return 'git blame';
  if (/\bgit\s+cat-file\b/i.test(seg)) return 'git cat-file';
  return null;
}

function detectLogQuery(seg) {
  if (/\bdocker\s+logs\b/i.test(seg)) return 'docker logs';
  if (/\bkubectl\s+logs\b/i.test(seg)) return 'kubectl logs';
  if (/(?:^|[;&]|\n)\s*journalctl\b/i.test(seg)) return 'journalctl';
  if (/\bpsql\b[^|]*-c\b/i.test(seg)) return 'psql -c';
  const jq = /\bjq\b\s*(.*)$/i.exec(seg);
  if (jq) {
    const rest = jq[1].trim();
    if (rest === '' || /^\.\s*(\S+)?$/.test(rest)) return 'jq (no filter)';
  }
  return null;
}

// ---- category registry ------------------------------------------------------
// kind: 'tool' -> "switch tools" wording. kind: 'narrow' -> "narrow at the
// source" wording, no tool is suggested.
const CATEGORIES = [
  { key: 'read-file', kind: 'tool', detect: detectReadFile, advice: 'the Read tool, with `offset`/`limit` if you only need part of the file' },
  { key: 'search', kind: 'tool', detect: detectSearch, advice: 'the Grep tool, with `head_limit` and `output_mode` to bound the result' },
  { key: 'list-files', kind: 'tool', detect: detectListFiles, advice: 'the Glob tool' },
  { key: 'web-fetch', kind: 'tool', detect: detectWebFetch, advice: 'the WebFetch tool' },
  { key: 'git-content', kind: 'narrow', detect: detectGitContent, advice: 'add `--stat`, `--name-only`, `-- <path>`, or `-n <num>` to narrow it before it runs' },
  { key: 'log-query', kind: 'narrow', detect: detectLogQuery, advice: 'add `--tail=N`, `-n N`, a SQL `LIMIT`, or a concrete jq filter to narrow it before it runs' },
];

function buildMessage(category, matched, cmd) {
  const prefix = '[dev-agents]';
  if (category.kind === 'tool') {
    return (
      `${prefix} This command ("${matched}" in \`${cmd}\`) fetches content through Bash/PowerShell. ` +
      `Use ${category.advice} instead of running it through the shell. Bash/PowerShell output ${TRUNCATION_WHY}`
    );
  }
  return (
    `${prefix} This command ("${matched}" in \`${cmd}\`) can return a large amount of content through ` +
    `Bash/PowerShell. There is no dedicated tool for this; narrow it at the source instead: ${category.advice}. ` +
    `Bash/PowerShell output ${TRUNCATION_WHY}`
  );
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

function quiet(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  if (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell') return;

  const cmd = input.tool_input && typeof input.tool_input.command === 'string'
    ? input.tool_input.command
    : null;
  if (!cmd) return;

  if (isExempt(cmd)) return;

  const session = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  quiet(() => fs.mkdirSync(STATE_DIR, { recursive: true }));

  const firstSeg = firstPipelineSegment(cmd);
  const parts = [];

  for (const category of CATEGORIES) {
    const matched = category.detect(firstSeg);
    if (!matched) continue;

    const flag = path.join(STATE_DIR, `${FLAG_PREFIX}${category.key}-${session}.flag`);
    if (fs.existsSync(flag)) continue;
    quiet(() => fs.writeFileSync(flag, '1'));

    parts.push(buildMessage(category, matched, cmd));
  }

  if (parts.length === 0) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: parts.join('\n\n'),
      },
    }) + '\n'
  );
}

main().catch(() => process.exit(0));
