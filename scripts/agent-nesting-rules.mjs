// Pure helper functions behind validate.mjs's two nesting-discipline checks.
//
// Split out from validate.mjs because that script calls report() and exits at
// module scope, so it cannot itself be imported by a test (see
// tests/sync-claude-md.test.mjs / scripts/sync-claude-md.mjs for the sibling
// case: that pair is instead tested by spawning the script as a subprocess.
// These functions have no top-level side effects, so tests import them
// directly instead).
//
// Why both checks exist at all: an agent body is always resident in the
// agent's prompt, while a skill is only conditionally loaded. When the two
// disagree, the body wins silently. A role agent that dispatches another role
// agent makes the parent block on a nested child for that child's full
// duration, which is the exact failure mode plugins/dev-agents/skills/
// nesting-discipline/SKILL.md exists to prevent.

// ---- check A: Agent-tool agents must carry nesting-discipline ---------------

/** `tools:` frontmatter is a comma-separated line; true if "Agent" is one of the items. */
export function hasAgentTool(toolsValue) {
  if (!toolsValue) return false;
  return toolsValue
    .split(',')
    .map((s) => s.trim())
    .includes('Agent');
}

// frontmatter() in validate.mjs is line-based key: value and cannot read a
// multi-line YAML list, so `skills:` gets its own small reader here rather
// than growing that parser for one caller.
/** Read the `skills:` list (block form or inline `[a, b]` form) from a file's frontmatter. */
export function readSkillsList(text) {
  if (!text.startsWith('---')) return [];
  const end = text.indexOf('\n---', 3);
  if (end === -1) return [];
  const block = text.slice(text.indexOf('\n', 3) + 1, end + 1);
  const skills = [];
  let inList = false;
  for (const line of block.split('\n')) {
    const inline = /^skills:\s*\[(.*)\]\s*$/.exec(line);
    if (inline) {
      for (const item of inline[1].split(',')) {
        const v = item.trim().replace(/^["']|["']$/g, '');
        if (v) skills.push(v);
      }
      inList = false;
      continue;
    }
    if (/^skills:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const item = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (item) {
        skills.push(item[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
      inList = false;
    }
  }
  return skills;
}

// ---- check B: body must not tell the agent to dispatch another role agent ---

// Verb phrases that read as "send this elsewhere", case-insensitive. The
// delegate/dispatch/route forms allow up to 40 characters of object text
// between the verb and "to" (e.g. "delegate large diffs to").
const FIXED_VERBS = [/\bgoes\s+to\b/i, /\bgo\s+to\b/i, /\bhand\s+(?:that|it|this|off)\s+to\b/i, /\bescalate\s+to\b/i];
const OBJECT_VERBS = [/\bdelegate\b[\s\S]{0,40}?\bto\b/i, /\bdispatch\b[\s\S]{0,40}?\bto\b/i, /\broute\b[\s\S]{0,40}?\bto\b/i];
const VERB_PATTERNS = [...FIXED_VERBS, ...OBJECT_VERBS];

// Route-back phrasing ("hand back to the caller", "let the main thread route
// back to X") is the desired pattern, not the contradiction this check hunts
// for, so it is exempted rather than flagged.
const ROUTE_BACK_RE = /back\s+to|hand\s+back/i;

const ALLOWED_TARGETS = new Set(['quick-read', 'quick-io']);

function matchVerb(line) {
  for (const re of VERB_PATTERNS) {
    const m = re.exec(line);
    if (m) return m[0];
  }
  return null;
}

/**
 * Everything after the closing `---` of a file's frontmatter, as
 * 1-indexed-from-the-real-file lines. Frontmatter is never scanned by the
 * dispatch-verb check below: `description:` legitimately names other agents
 * as caller-facing guidance and must not be flagged.
 */
export function bodyLinesAfterFrontmatter(text) {
  if (!text.startsWith('---')) return { startLine: 1, lines: text.split('\n') };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { startLine: 1, lines: text.split('\n') };
  const afterClosing = text.indexOf('\n', end + 1);
  const bodyStart = afterClosing === -1 ? text.length : afterClosing + 1;
  const startLine = text.slice(0, bodyStart).split('\n').length;
  return { startLine, lines: text.slice(bodyStart).split('\n') };
}

/**
 * Scan body lines for `dev-agents:X` where X is not quick-read/quick-io and
 * the same line also carries a dispatch verb. Returns one entry per offending
 * line, with the real file line number.
 */
export function findDispatchViolations(lines, startLine = 1) {
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ROUTE_BACK_RE.test(line)) continue;

    const targets = [...line.matchAll(/dev-agents:([A-Za-z0-9_-]+)/g)]
      .map((m) => m[1])
      .filter((t) => !ALLOWED_TARGETS.has(t));
    if (targets.length === 0) continue;

    const verb = matchVerb(line);
    if (!verb) continue;

    violations.push({ line: startLine + i, target: targets[0], verb });
  }
  return violations;
}
