// Tests for scripts/agent-nesting-rules.mjs, the two pure checks behind
// validate.mjs's Agent-tool nesting-discipline rules.
//
//   node --test "tests/*.test.mjs"
//
// validate.mjs itself calls report() and exits at module scope, so these
// functions live in their own side-effect-free module and are imported
// directly here rather than exercised through a subprocess.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAgentTool,
  readSkillsList,
  bodyLinesAfterFrontmatter,
  findDispatchViolations,
} from '../scripts/agent-nesting-rules.mjs';

test('hasAgentTool: true when "Agent" is one of the comma-separated tools', () => {
  assert.equal(hasAgentTool('Read, Grep, Glob, Agent'), true);
  assert.equal(hasAgentTool('Read, Grep, Glob'), false);
  assert.equal(hasAgentTool(''), false);
  assert.equal(hasAgentTool(undefined), false);
});

test('readSkillsList: reads a block-form skills: list from frontmatter', () => {
  const text = ['---', 'name: deepthink', 'skills:', '  - systematic-debugging', '  - nesting-discipline', '---', '', 'body'].join(
    '\n'
  );
  assert.deepEqual(readSkillsList(text), ['systematic-debugging', 'nesting-discipline']);
});

test('readSkillsList: agent missing nesting-discipline is caught by the caller', () => {
  const text = ['---', 'name: some-agent', 'tools: Read, Agent', 'skills:', '  - some-other-skill', '---', '', 'body'].join('\n');
  const skills = readSkillsList(text);
  assert.equal(skills.includes('nesting-discipline'), false);
});

test('bodyLinesAfterFrontmatter: skips frontmatter, keeps real file line numbers', () => {
  const text = ['---', 'name: x', 'description: hand that to deepthink', '---', '', 'first body line', 'second body line'].join('\n');
  const { startLine, lines } = bodyLinesAfterFrontmatter(text);
  assert.equal(startLine, 5);
  assert.deepEqual(lines, ['', 'first body line', 'second body line']);
});

test('findDispatchViolations: flags "goes to `dev-agents:deepthink`"', () => {
  const lines = ['Something goes to `dev-agents:deepthink` for review.'];
  const violations = findDispatchViolations(lines, 10);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 10);
  assert.equal(violations[0].target, 'deepthink');
  assert.match(violations[0].verb, /goes to/i);
});

test('findDispatchViolations: does not flag delegating to quick-read', () => {
  const lines = ['Get the diff yourself, or delegate large diffs to `dev-agents:quick-read`.'];
  assert.deepEqual(findDispatchViolations(lines, 1), []);
});

test('a description: frontmatter line naming another agent is never scanned, end to end', () => {
  // The frontmatter line below would trip the dispatch-verb check on its own
  // ("hand that to" + a disallowed target), which is exactly why validate.mjs
  // uses bodyLinesAfterFrontmatter to exclude frontmatter before ever calling
  // findDispatchViolations. Exercise that boundary together, not the verb
  // matcher in isolation, since description: is legitimately allowed to name
  // other agents as caller-facing guidance.
  const text = [
    '---',
    'name: some-agent',
    'description: hand that to `dev-agents:deepthink` when things get architectural',
    'tools: Read, Agent',
    '---',
    '',
    'This body line is unrelated and mutates nothing.',
  ].join('\n');
  const { startLine, lines } = bodyLinesAfterFrontmatter(text);
  assert.deepEqual(findDispatchViolations(lines, startLine), []);
});

test('findDispatchViolations: "hand it back to" is route-back phrasing, not flagged', () => {
  const lines = ['If this needs a command that mutates anything, hand it back to `dev-agents:quick-io` or a role agent.'];
  assert.deepEqual(findDispatchViolations(lines, 1), []);
});

test('findDispatchViolations: "back to" anywhere on the line exempts it, even with a disallowed target', () => {
  const lines = ['Route this back to `dev-agents:deepthink` if it needs a design call.'];
  assert.deepEqual(findDispatchViolations(lines, 1), []);
});
