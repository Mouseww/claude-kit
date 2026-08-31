# dev-agents

This plugin packages eleven subagents with the model tier fixed per role, five
reminder hooks, and a `CLAUDE.md` block. It exists so that reading, writing, and
reviewing code each land on the cheapest model tier that can do the job well,
without the main thread having to re-decide that on every turn. This file is the
design record: why the pack is shaped the way it is, and what each hook actually
does.

## How the pack is wired

Four layers, each doing a different job:

- `claude-md-block.md`, installed via `/dev-agents:sync-claude-md`, is resident
  on every turn. It carries the routing table and the write-handoff rule in
  about 3.5k characters, and it is the thing that actually drives day-to-day
  behaviour.
- `skills/dev-agents/SKILL.md`, loaded on demand, holds the decision rules and
  checklists an agent consults at the moment it is deciding what to do.
- The five hooks (below) are reminders only. None of them ever blocks a tool
  call.
- Agent frontmatter is the only hard guarantee in the pack: it binds the model
  tier, and nothing short of that is enforced mechanically.

This README is the design record and the hook reference. Neither this file nor
the hooks are loaded into an agent's context; only the skill and the CLAUDE.md
block are.

## Why delegation works

Main-thread context only grows. Every tool result (file contents, grep hits,
build logs) stays in the history, and every later step carries all of it. A
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
was still written by the main thread on an expensive one. See the write-handoff
guidance in the `dev-agents` skill.

## Delegation is a layer, not a phase

Both arguments are about a **unit of work**, not about where you are in the task.
A tier is chosen per read and per write, so neither argument waits for
implementation to begin.

In practice the reverse holds. Clarifying the ask, brainstorming, writing the plan
and reviewing a design are usually where the *heaviest* reading of the whole task
happens, because that is when you are surveying an unfamiliar codebase, checking
conventions and locating call sites. Confining delegation to the implementation
phase therefore leaves the largest reads sitting on the most expensive model.

The stage-by-stage routing table lives in the `dev-agents` skill, not here.

The one thing that stays in the main thread at every stage is the deciding
itself. Everything feeding into a decision, and everything carrying it out, can
go to a subagent.

This is easy to lose because delegation reads like a step in a sequence, and the
planning skills that usually run first (brainstorming, writing a plan, systematic
debugging) each describe a stage. Those skills say what the current step is for;
this one says which model executes each read and write inside it. They are
orthogonal, so nothing here belongs in that sequence.

## Design notes on the agents

### Base primitives

haiku is on the read-only role rather than on `quick-io` deliberately: its error
rate on writes is noticeably higher, and a read that goes wrong costs you a wrong
answer rather than a damaged file. You get the cheap tier without gambling code
quality on it. Both primitives are told to hand work back when it turns out to
need judgement.

Both have Bash, because command output (a build log, a test run, `git log`) is
the heaviest raw output there is, and the whole point of these agents is that it
lands in their context rather than yours. The split is what they may run:
`quick-read` is confined to inspection commands, `quick-io` may also format,
move files, and run a targeted check on what it just edited. Note that this
split is enforced by their prompts, not by the tool grant: `Bash` is all or
nothing in agent frontmatter. If you need it enforced mechanically, deny the
commands in `permissions` rather than relying on the agent text.

`deepthink` has `Write` so it can produce a design doc, ADR or analysis, but its
guardrail is that it produces **only** those documents. It does not touch source
or implement features. That forces it to explain the approach and hand it back,
instead of quietly doing the implementation too.

### The last resort

`last-resort` is different in kind from the other ten. They are routed by *what
the work is*; this one is gated on *what has already been tried*. The four
preconditions that all have to hold before it is worth its cost live in the
`dev-agents` skill.

Its prompt tells it to attack the problem *statement* before the problem, on the
premise that an impasse surviving an opus attempt is usually a wrong framing, an
unchecked constraint or an inherited assumption rather than a missing technique.
It has `Bash` specifically to reproduce the reported failure, because "the
failure is not what it was described as" is a real and common answer. It has
`Write` but not `Edit`, the same guardrail as `deepthink`: conclusions, never
source.

Two instructions in it exist to counter its own tier. It is told to say so
plainly when the answer turns out to be small, rather than inflating to justify
the call. And it is told to push bulk reading down to `quick-read` rather than
spending the most expensive context in the session on file dumps.

## The hooks

Five hooks ship with this pack. All are reminders. None of them ever blocks a
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
has to be redone. It never fires inside a subagent: `quick-read` reads a lot by
design and has no `Agent` tool to act on the advice anyway.

Tunables are at the top of `scripts/nudge-subagent-delegation.mjs`.

### `track-task-plan` + `require-task-plan`

A pair, communicating through a per-session flag file.

- `track-task-plan` (PostToolUse on `TaskCreate`) records that a plan now exists.
- `require-task-plan` (PreToolUse on `Agent`) checks for that record before a
  subagent is dispatched, and reminds you to build a plan first if there is none.

It fires on the first planless dispatch, then every third after that, enough
pressure on genuine multi-step work without nagging a one-shot handoff. It never
fires inside a subagent, so nested delegation is untouched. Creating a plan
resets the counter, so if a plan is abandoned mid-session the reminder comes
back rather than staying silenced.

Set `REPEAT_EVERY = 1` at the top of `scripts/require-task-plan.mjs` to nudge on
every planless dispatch instead.

### `check-subagent-return`

PostToolUse on `Agent`, the counterpart to the pair above: they fire before a
dispatch, this one fires on what comes back. Three branches, checked in order,
and at most one speaks per call.

| Branch | Condition | Throttle |
|---|---|---|
| Background ack | the call went out with `run_in_background: true` | once per session |
| Failure | `tool_response` null, a truthy `interrupted` / `stoppedByUser` / `toolDenialKind` / `is_error` / `error` flag, an interruption marker in the text, or empty text | none, every time |
| Thin result | returned text shorter than `THIN_CHARS` (80) | first, then every third |

The failure branch is deliberately unthrottled: a dispatch that did not happen
is worth interrupting for every single time, and unlike the write-streak nudge
there is no judgement call for it to get wrong.

The reason `tool_response` is probed rather than read is that its shape is
version dependent, the same caveat `measure-subagent.mjs` carries: it may be a
string, an array of content blocks, an object with `.content`, or something
else. The script extracts text from all of those and, separately, keeps the
response object so its flags can still be inspected when no text comes out.

It never fires inside a subagent. Tunables (`THIN_CHARS`, `REPEAT_EVERY`) are at
the top of `scripts/check-subagent-return.mjs`.

### `gate-last-resort`

PreToolUse on `Agent`, firing only when the dispatched `subagent_type` contains
`last-resort` (a substring test, so both the bare and the namespaced id match).
It prints the four preconditions from the `last-resort` section of the
`dev-agents` skill and asks for them to be confirmed out loud in that turn.

Deliberately **unthrottled and stateless**, unlike `require-task-plan`. That hook
throttles because a planless dispatch is common and nagging it is worse than
missing one. This dispatch is rare by definition and the most expensive mistake
the pack can make, so it gets the full checklist every single time and keeps no
flag file to go stale.

### `nudge-content-fetch`

PreToolUse on `Bash|PowerShell`, 5s. Reads `tool_input.command` before the
command runs and, if it is a command whose whole purpose is to pull content
into context, says so once. It never denies and never touches output.

Six categories in two deliberately unmerged shapes:

| Shape | Categories | What it says |
|---|---|---|
| Tool precedence | `read-file`, `search`, `list-files`, `web-fetch` | a dedicated tool does this without a shell: Read with `offset`/`limit`, Grep with `head_limit`, Glob, WebFetch |
| Narrow at source | `git-content`, `log-query` | no tool replaces `git diff` or `docker logs`, so add `--stat`, `-- <path>`, `--tail=N`, a SQL `LIMIT`, a real jq filter |

Throttled per category per session via a flag file under the temp dir, so a
session sees at most six of these. Exemptions are deliberately permissive and
kill the check entirely: heredoc writes, output redirected to a file, a pipe
into `head`/`tail`/`wc`/`grep`/`Select-Object -First`, a command already
carrying `-n`/`--tail`/`--stat`/`--oneline`/`LIMIT`, and `git log -p` with an
explicit path. It would rather miss a real case than nag a command that is
already narrow.

This is the only hook in the pack that can stop the cost from happening at all.
It used to justify itself by pointing at context-trim's truncation, and that
rationale expired in context-trim 1.3.0: clean output now passes through intact
below 30000 characters, precisely because cutting a result the model went and
fetched is what makes it fetch the result again. So the split is now clean, this
hook is the pre-emptive half and context-trim's advice path is the post-hoc half
that only fires when the output really did come back large.

Note the overlap if you also run the `rtk` pack: both sit on PreToolUse and both
watch `cat`/`grep`/`find`/`git`. They do different things. rtk swaps the command
for one that prints less; this hook argues for a tool that reads less in the
first place. Running both is fine, and `Read` with an `offset` still beats a
compressed dump of the whole file.

## The honest limit: this does not control the main thread's model

`/model opusplan` has opus plan and then **the platform switches to sonnet to
execute**. That switch is done by the platform, not by the model choosing to
cooperate, which makes it the most reliable way to get execution and file writes
onto a cheap tier.

The boundary matters. The seven sonnet role agents genuinely run on sonnet once
invoked, because the tier in their frontmatter is a hard guarantee. But **nothing
stops the main thread from using its own Edit/Write**, and the main thread runs
on whatever model is active. The write-streak nudge and the write-handoff
guidance in the `dev-agents` skill both point at this, but they are reminders,
not enforcement.

So the two are complementary: subagents cover work that delegation moves,
`opusplan` covers everything else. This plugin does not replace it.

## Is any of this paying off?

Install the `context-trim` plugin alongside this one. Its `measure-subagent` hook
logs every subagent call (agent name, characters returned, duration, and real
token usage from the Agent tool's telemetry) and its report answers three things
that are otherwise invisible:

1. Which agents never get used. Zero invocations after a week is dead weight in
   the always-resident agent list; delete it.
2. How much context each delegation hands back. An agent routinely returning
   4000+ characters is not distilling anything, so that delegation is close to
   net zero.
3. Whether role agents delegate down at all.

The central assumption here, that delegating beats reading inline, can be
wrong for your workload. Measure it rather than trusting the theory.
