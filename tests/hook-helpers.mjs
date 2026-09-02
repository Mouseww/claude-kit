// Shared data and helpers for the vendored-helper drift guard.
//
// Deliberately NOT a *.test.mjs file: node --test executes every top-level
// test() call in a file the moment it is imported, even when the import is
// for its exports rather than to run it as a suite. hook-helpers-consistent
// and atomic-write-behavior both need HELPER_OWNERS and extractMarkerBlock;
// if either imported the other's *.test.mjs file directly, its test() calls
// would register a second time in the importing process and inflate the
// count. This module holds the data and the pure function only, so importing
// it never runs a test.

// Which scripts must carry which helper. A file listed here and missing the
// block is a failure; so is a file carrying a block nobody registered.
export const HELPER_OWNERS = {
  quiet: [
    'plugins/dev-agents/scripts/require-task-plan.mjs',
    'plugins/dev-agents/scripts/track-task-plan.mjs',
    'plugins/dev-agents/scripts/check-subagent-return.mjs',
    'plugins/dev-agents/scripts/nudge-subagent-delegation.mjs',
    'plugins/dev-agents/scripts/nudge-content-fetch.mjs',
    'plugins/dev-agents/scripts/gate-last-resort.mjs',
    'plugins/context-trim/scripts/truncate-verbose-output.mjs',
    'plugins/context-trim/scripts/measure-subagent.mjs',
    'plugins/rtk/scripts/rtk-rewrite.mjs',
  ],
  readStdin: [
    'plugins/dev-agents/scripts/require-task-plan.mjs',
    'plugins/dev-agents/scripts/track-task-plan.mjs',
    'plugins/dev-agents/scripts/check-subagent-return.mjs',
    'plugins/dev-agents/scripts/nudge-subagent-delegation.mjs',
    'plugins/dev-agents/scripts/nudge-content-fetch.mjs',
    'plugins/dev-agents/scripts/gate-last-resort.mjs',
    'plugins/context-trim/scripts/truncate-verbose-output.mjs',
    'plugins/context-trim/scripts/measure-subagent.mjs',
    'plugins/claude-kit-meta/scripts/check-daily-update.mjs',
    'plugins/rtk/scripts/rtk-rewrite.mjs',
  ],
  atomicWrite: [
    'plugins/dev-agents/scripts/require-task-plan.mjs',
    'plugins/dev-agents/scripts/track-task-plan.mjs',
    'plugins/dev-agents/scripts/check-subagent-return.mjs',
    'plugins/dev-agents/scripts/nudge-subagent-delegation.mjs',
    'plugins/dev-agents/scripts/nudge-content-fetch.mjs',
    'plugins/context-trim/scripts/measure-subagent.mjs',
  ],
};

// Returns the marker block including both marker lines, or null when absent.
// Deliberately string-based, not regex-based: the block contains regex-hostile
// characters and a literal search cannot misfire on them.
export function extractMarkerBlock(text, name) {
  const open = `// --- shared:${name} ---`;
  const close = `// --- /shared:${name} ---`;
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.indexOf(close, start);
  if (end === -1) return null;
  return text.slice(start, end + close.length);
}
