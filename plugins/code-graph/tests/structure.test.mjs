// Structural checks for the code-graph pack. This pack wraps an external CLI
// (code-review-graph) that is not installed in CI, so these tests assert
// shape only: plugin.json/marketplace consistency, the MCP server
// declaration, and skill frontmatter. They never start the MCP server or
// invoke the CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(HERE, '..');
const ROOT = path.join(PACK, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('---'), `${file} has no frontmatter`);
  const end = text.indexOf('\n---', 3);
  const block = text.slice(text.indexOf('\n', 3) + 1, end + 1);
  const out = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

test('plugin.json name equals the directory name', () => {
  const plugin = readJson(path.join(PACK, '.claude-plugin', 'plugin.json'));
  assert.equal(plugin.name, path.basename(PACK));
  assert.equal(plugin.name, 'code-graph');
});

test('plugin.json is disabled by default, since it depends on an external service', () => {
  const plugin = readJson(path.join(PACK, '.claude-plugin', 'plugin.json'));
  assert.equal(plugin.defaultEnabled, false);
});

test('plugin.json has no inline mcpServers key; the MCP server lives in .mcp.json instead', () => {
  const plugin = readJson(path.join(PACK, '.claude-plugin', 'plugin.json'));
  assert.equal(plugin.mcpServers, undefined);
});

const EXPECTED_TOOLS = [
  'get_minimal_context_tool',
  'semantic_search_nodes_tool',
  'query_graph_tool',
  'traverse_graph_tool',
  'get_impact_radius_tool',
  'get_review_context_tool',
  'detect_changes_tool',
  'list_graph_stats_tool',
  'build_or_update_graph_tool',
];

function mcpServerArgs() {
  const mcp = readJson(path.join(PACK, '.mcp.json'));
  assert.ok(mcp.mcpServers && mcp.mcpServers['code-review-graph'], 'missing code-review-graph server entry');
  return mcp.mcpServers['code-review-graph'].args;
}

test('.mcp.json declares the code-review-graph stdio server', () => {
  const mcp = readJson(path.join(PACK, '.mcp.json'));
  assert.ok(mcp.mcpServers && mcp.mcpServers['code-review-graph'], 'missing code-review-graph server entry');
  const server = mcp.mcpServers['code-review-graph'];
  assert.equal(server.command, 'code-review-graph');
  assert.ok(server.args.includes('serve'), 'args must include the serve subcommand');
});

test('.mcp.json passes --repo pointing at ${CLAUDE_PROJECT_DIR}', () => {
  const args = mcpServerArgs();
  const idx = args.indexOf('--repo');
  assert.ok(idx !== -1, '--repo flag missing from args');
  assert.equal(args[idx + 1], '${CLAUDE_PROJECT_DIR}');
});

test('.mcp.json restricts --tools to exactly the 9-tool whitelist', () => {
  const args = mcpServerArgs();
  const idx = args.indexOf('--tools');
  assert.ok(idx !== -1, '--tools flag missing from args');
  const whitelist = args[idx + 1].split(',');
  assert.deepEqual(
    [...whitelist].sort(),
    [...EXPECTED_TOOLS].sort(),
    'the --tools whitelist must be exactly the 9 approved tools, no more, no fewer'
  );
});

test('.mcp.json does not pass --http, so the server stays on stdio transport', () => {
  const args = mcpServerArgs();
  assert.ok(!args.includes('--http'), 'server must run over stdio, not HTTP');
});

test('apply_refactor_tool is excluded: it rewrites source files, and this pack must stay read-only', () => {
  const args = mcpServerArgs();
  const idx = args.indexOf('--tools');
  const whitelist = args[idx + 1].split(',');
  assert.ok(!whitelist.includes('apply_refactor_tool'), 'apply_refactor_tool would give this pack write access to source files');
});

test('refactor_tool is excluded: it is the preview counterpart of a source-writing tool', () => {
  const args = mcpServerArgs();
  const idx = args.indexOf('--tools');
  const whitelist = args[idx + 1].split(',');
  assert.ok(!whitelist.includes('refactor_tool'), 'refactor_tool previews source rewrites this pack should not offer');
});

test('embed_graph_tool is excluded: it can trigger model downloads or cloud calls', () => {
  const args = mcpServerArgs();
  const idx = args.indexOf('--tools');
  const whitelist = args[idx + 1].split(',');
  assert.ok(!whitelist.includes('embed_graph_tool'), 'embed_graph_tool conflicts with this pack shipping no outbound calls');
});

test('marketplace.json lists code-graph with a matching name and a real source', () => {
  const marketplace = readJson(path.join(ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = marketplace.plugins.find((p) => p.name === 'code-graph');
  assert.ok(entry, 'code-graph missing from marketplace.json');
  assert.equal(entry.source, './plugins/code-graph');
  assert.ok(entry.description && entry.description.length > 0);
  assert.ok(fs.existsSync(path.resolve(ROOT, entry.source, '.claude-plugin', 'plugin.json')));
});

test('code-graph skill exists with frontmatter name matching its directory', () => {
  const skillFile = path.join(PACK, 'skills', 'code-graph', 'SKILL.md');
  assert.ok(fs.existsSync(skillFile));
  const fm = frontmatter(skillFile);
  assert.equal(fm.name, 'code-graph');
  assert.ok(fm.description && fm.description.length >= 40, 'description too short to guide relevance');
});

test('setup and refresh commands exist with a description', () => {
  for (const name of ['setup.md', 'refresh.md']) {
    const file = path.join(PACK, 'commands', name);
    assert.ok(fs.existsSync(file), `missing commands/${name}`);
    const fm = frontmatter(file);
    assert.ok(fm.description && fm.description.length > 0, `${name} frontmatter missing description`);
  }
});

test('no hooks directory ships with this pack', () => {
  assert.equal(fs.existsSync(path.join(PACK, 'hooks')), false);
});
