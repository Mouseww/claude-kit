---
name: dev-agents
description: Use when a task is long or multi-step and you are deciding what to do yourself versus hand to a subagent - searching code, reading several files, running commands with verbose output, needing an independent review, or weighing several designs. Explains which of the ten packaged agents to pick, what model tier each is bound to, how to brief one so the handoff is not a net loss, and when delegating is the wrong call. Apply it even when nobody mentioned saving tokens.
---

# dev-agents

Ten subagents with the model tier fixed per role, three reminder hooks, and a
`CLAUDE.md` block.

**Read this only when you need the reasoning.** The pack's day-to-day behaviour
comes from the `CLAUDE.md` block (`/dev-agents:sync-claude-md`), which is
resident on every turn and carries the routing table and the write-handoff rule
in about 2.4k characters. This document is the long-form justification behind it:
why delegation works, when it is a net loss, and what it cannot do. Loading it
costs roughly 3.4k tokens, so do not pull it in for a decision the block already
answers.

## Why delegation works

Main-thread context only grows. Every tool result — file contents, grep hits,
build logs — stays in the history, and every later step carries all of it. A
subagent has its own context: whatever it reads or runs inside stays inside, and
only its final answer comes back. That is a structural reduction, not a soft
"be more concise" suggestion that depends on the model cooperating.

Delegation serves **two different goals**, and most work triggers only one:

1. **Keep raw output out of the main thread.** The context argument above. This
   is about reads.
2. **Move typing off an expensive model.** Reading costs context; writing code
   costs time on whatever tier the main thread is running. That cost never shows
   up in the transcript, which is exactly why it gets missed.

An earlier version of this guidance only made argument 1, with an observable
consequence: exploration got delegated to cheap models while every line of code
was still written by the main thread on an expensive one. See
[Handing off writes](#handing-off-writes).

## The agents

### Base primitives

| Agent | Model | For |
|---|---|---|
| `quick-read` | haiku | Read-only: search, extract, summarize. No write access, no Bash |
| `quick-io` | sonnet | Mechanical file changes that follow a rule you can state |
| `deepthink` | opus | Design judgement, trade-offs, hard diagnosis. Writes conclusions, never implements |

haiku is on the read-only role rather than on `quick-io` deliberately: its error
rate on writes is noticeably higher, and a read that goes wrong cannot damage
anything. You get the cheap tier without gambling code quality on it. Both
primitives are told to hand work back when it turns out to need judgement.

`deepthink` has `Write` so it can produce a design doc, ADR or analysis, but its
guardrail is that it produces **only** those documents. It does not touch source
or implement features. That forces it to explain the approach and hand it back,
instead of quietly doing the implementation too.

### Role agents

For delegating a whole coherent chunk of a role, with the tier already bound.

| Agent | Model | Owns |
|---|---|---|
| `requirements-analyst` | opus | Turning a vague ask into a spec: user stories, acceptance criteria, task breakdown |
| `backend-dev` | sonnet | APIs, business logic, data access, validation, error handling |
| `frontend-dev` | sonnet | Components, state, styling, accessibility, wiring to APIs |
| `ui-ux-designer` | sonnet | Interaction flows, information architecture, state design, prototypes |
| `test-engineer` | sonnet | Unit/integration/e2e, TDD, coverage gaps; includes Playwright |
| `quality-reviewer` | sonnet | Reviewing a diff, severity-ranked findings, read-only |
| `devops-engineer` | sonnet | CI/CD, containers, release scripts, migrations, rollback |

Installed through this plugin the ids are namespaced: `dev-agents:quick-read`,
`dev-agents:backend-dev`, and so on.

## When to delegate

Ask these about the subtask:

- **Is it read-only and exploratory** — searching code, understanding a
  structure, verifying a fact, with no side effect on main-thread state? Almost
  always worth delegating, as long as what comes back is a conclusion and not a
  dump.
- **Will it produce a lot of verbose output** — test logs, build output, a search
  across many files? Delegating keeps that inside the subagent.
- **Is it a self-contained piece of a larger task** — "implement X in module Y",
  one of several modules that could run in parallel? Its internal debugging and
  backtracking never pollutes the main thread.
- **Is it a verification or review step** where a fresh perspective helps, because
  a clean context notices what an accumulated one has stopped seeing?

## Handing off writes

Once you already know how the code should be written, **typing it is the
expensive part, not deciding it.** If you are about to write a change you have
fully worked out, hand it over instead:

- Follows a rule you can state, or is already fully decided → `quick-io`
- A bounded chunk of one domain → the matching role agent

**Hand over the decision, not the finished code.** The interface, the rule, the
file list, the constraints — that is the brief. A brief containing the complete
code costs as many tokens as writing it yourself, and that is the trap that makes
write delegation look useless.

This applies **mid-task**, not just at the start. You do not have to hand over a
whole feature to hand over one implementation step. Deciding yourself and then
passing the decision down is the intended use, not a compromise.

When each remaining edit needs a fresh judgement call, keep going in the main
thread. That is a legitimate answer, not a failure to delegate.

## When not to delegate

Not everything should go to a subagent.

- **Small single-file, single-line edits.** Doing it directly is faster; the
  latency and briefing overhead outweigh the tokens saved.
- **Anything needing continuous back-and-forth with the user**, or depending on
  the current conversation. A subagent loses that context.
- **Creating substantial new content from scratch.** Writing a document or a
  design from nothing means the content exists only in your context, so any brief
  has to carry all of it. This differs from *implementing a decision already
  made*, where the brief **is** the decision and the agent supplies the volume.

And the one that is easiest to forget: **delegation itself costs.** The subagent
re-pays its own system prompt plus whatever context you hand it, and the parent
still pays for the summary coming back. For a two-file read, delegation is
probably net negative. If writing the brief costs more than it saves, do it
yourself. Note the asymmetry though: for an already-decided implementation the
brief is short and the output is long, so this rule points the other way.

## Briefing well

A badly briefed subagent re-discovers what the main thread already knew. Those
tokens do not hit the main thread, but they are still waste, and the result is
worse.

- **Give the known context up front**: relevant file paths, possibilities already
  ruled out, key symbol names and conventions. Let it start working rather than
  orienting.
- **Ask explicitly for conclusions only** — a one-line answer, a diff summary, a
  pass/fail — not a transcript or whole files, unless the user needs the detail.
- **Dispatch independent parts in one turn**, several agents at once, rather than
  one at a time round-tripping.
- **For long multi-step tasks, build a task list first** (see below), then
  delegate the read-heavy exploratory items one by one while the main thread does
  decisions and integration.

## Composing primitives with role agents

The reliable pattern is **main-thread orchestration**: the main thread conducts —
`deepthink` for the approach, the matching role agent to land it,
`quality-reviewer` to audit, `quick-io` for cleanup — with the primitives
handling cross-role odds and ends.

The role agents all carry the `Agent` tool, so they can push cheap sub-work back
down to the primitives. Treat nesting as an optimization, never the main path: if
a nested call fails, the role agent should finish the work itself rather than
stall. To check whether nesting actually happens in your setup, run the metrics
report from the `context-trim` plugin.

## Task lists before dispatching

When a task has more than two steps, build the task list **before** dispatching
any subagent, and mark each step done as you finish it.

The failure this prevents: the main thread says in conversation "next I will do
1, 2, 3", dispatches a subagent for step 1, and while that runs the conversation
history gets compacted and the spoken plan is dropped. The subagent returns and
the main thread no longer knows steps 2 and 3 exist. A tracked task list survives
compaction; a sentence in the transcript does not.

A hook pair backs this up (see below), but the rule stands on its own: the cost
of a lost plan is redoing work, and the cost of the task list is a few seconds.

## The hooks

Three hooks ship with this pack. All are reminders. None of them ever blocks a
tool call.

### `nudge-subagent-delegation`

Tracks two consecutive-operation counters in the main thread and speaks once past
each threshold:

| Streak | Default | Suggests |
|---|---|---|
| Consecutive Read/Grep/Glob | 16 | `quick-read` |
| Consecutive Edit/Write | 8 | `quick-io` or a role agent |

Anything else breaks both streaks, so the counts are consecutive rather than
cumulative. The write message is phrased as a question, because a hook cannot
tell a mechanical edit from one needing judgement, and over-nudging on writes is
worse than on reads: a wrong handoff costs a round trip and can produce code that
has to be redone. It never fires inside a subagent — `quick-read` reads a lot by
design and has no `Agent` tool to act on the advice anyway.

Tunables are at the top of `scripts/nudge-subagent-delegation.mjs`.

### `track-task-plan` + `require-task-plan`

A pair, communicating through a per-session flag file.

- `track-task-plan` (PostToolUse on `TaskCreate`) records that a plan now exists.
- `require-task-plan` (PreToolUse on `Agent`) checks for that record before a
  subagent is dispatched, and reminds you to build a plan first if there is none.

It fires on the first planless dispatch, then every third after that — enough
pressure on genuine multi-step work without nagging a one-shot handoff. It never
fires inside a subagent, so nested delegation is untouched. Creating a plan
resets the counter, so if a plan is abandoned mid-session the reminder comes
back rather than staying silenced.

Set `REPEAT_EVERY = 1` at the top of `scripts/require-task-plan.mjs` to nudge on
every planless dispatch instead.

## The honest limit: this does not control the main thread's model

`/model opusplan` has opus plan and then **the platform switches to sonnet to
execute**. That switch is done by the platform, not by the model choosing to
cooperate, which makes it the most reliable way to get execution and file writes
onto a cheap tier.

The boundary matters. The seven sonnet role agents genuinely run on sonnet once
invoked, because the tier in their frontmatter is a hard guarantee. But **nothing
stops the main thread from using its own Edit/Write**, and the main thread runs
on whatever model is active. The write-streak nudge and the
[Handing off writes](#handing-off-writes) section above both point at this, but
they are reminders, not enforcement.

So the two are complementary: subagents cover work that delegation moves,
`opusplan` covers everything else. This plugin does not replace it.

## Is any of this actually paying off?

Install the `context-trim` plugin alongside this one. Its `measure-subagent` hook
logs every subagent call — agent name, characters returned, duration, and real
token usage from the Agent tool's telemetry — and its report answers three things
that are otherwise invisible:

1. Which agents never get used. Zero invocations after a week is dead weight in
   the always-resident agent list; delete it.
2. How much context each delegation hands back. An agent routinely returning
   4000+ characters is not distilling anything, so that delegation is close to
   net zero.
3. Whether role agents delegate down at all.

The central assumption here — that delegating beats reading inline — can be
wrong for your workload. Measure it rather than trusting the theory.
