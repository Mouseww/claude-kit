---
name: dev-agents
description: Use when a task is long or multi-step and you are deciding what to do yourself versus hand to a subagent - searching code, reading several files, running commands with verbose output, needing an independent review, or weighing several designs. Routes the next action to one of eleven packaged agents with the model tier already bound, gives the pre-dispatch checklist and the brief template, and states how to tell a failed dispatch from a real result. Apply it even when nobody mentioned saving tokens.
---

# dev-agents

Eleven subagents with the model tier fixed per role. This file is the decision
procedure: what to route where, what to check before dispatching, and how to
tell a failed dispatch from a real one.

The main thread decides. Everything feeding a decision, and everything carrying
it out, goes to a subagent.

The design record, the hook internals and their tunables are in `README.md` at
the plugin root. You do not need them to route a task; do not load them for one.

## Route the next action

Look up what you are about to do. Do not deliberate over it, the table is the
answer.

| About to | Dispatch |
|---|---|
| Search the codebase, locate call sites, check a local convention | `quick-read` |
| Read a file to answer one question | `quick-read` |
| Run a command and skim its output (`git log`, a diff, a build or test log) | `quick-read` |
| Make an edit that follows a rule you can state | `quick-io` |
| Write out a change you have already fully decided | `quick-io`, or the role agent |
| Weigh two approaches, review a plan or spec, root-cause a hard bug | `deepthink` |
| Turn a vague ask into a spec | `requirements-analyst` |
| Land a bounded chunk of one domain | the matching role agent |
| Audit a diff | `quality-reviewer` |

Route by unit of work, not by phase. Clarifying the ask, brainstorming and
planning are usually where the heaviest reading of the whole task happens,
because that is when you survey an unfamiliar codebase and locate call sites.

| Stage | What gets read or written | Route to |
|---|---|---|
| Clarifying the ask | Current behaviour, prior art, local conventions | `quick-read` |
| Brainstorming, planning | Call sites, affected files, interface signatures | `quick-read` |
| Design review | Whether the approach holds up | `deepthink` |
| Diagnosis | Logs, stack traces, version diffs | `quick-read`, then `deepthink` for the root cause |
| Implementation | A change already decided | `quick-io` or the matching role agent |
| Verification | Test runs, build output | `test-engineer`, `devops-engineer` |

When two agents both fit, take the lower tier: `quick-io` over a role agent, a
role agent over `deepthink`. The cheaper one escalates if the task turns out to
need judgement, and that escalation costs less than a wasted opus call.

Between the two opus agents: vague request in, structured spec out goes to
`requirements-analyst`; proposal or plan in, verdict out goes to `deepthink`.

## The agents

Installed through this plugin the ids are namespaced: `dev-agents:quick-read`,
`dev-agents:backend-dev`, and so on.

### Primitives

| Agent | Model | For |
|---|---|---|
| `quick-read` | haiku | Read-only: search, extract, summarize, plus inspection commands. No Edit/Write |
| `quick-io` | sonnet | Mechanical file changes that follow a rule you can state. Has Bash, so it can format, move files, and run a targeted check on what it touched |
| `deepthink` | opus | Design judgement, trade-offs, hard diagnosis. Writes conclusions, never implements |

Both primitives hand work back when it turns out to need judgement. Take that
handback rather than re-briefing the same agent.

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

Orchestrate from the main thread: `deepthink` for the approach, the role agent
to land it, `quality-reviewer` to audit, `quick-io` for cleanup. Role agents
carry the `Agent` tool and may push cheap sub-work down to the primitives, but
treat that nesting as an optimization: if a nested call fails, the role agent
finishes the work itself rather than stalling.

### `last-resort` (fable)

Gated on what has already been tried, not on what the work is. **All four must
hold. State each one out loud in the dispatching turn.**

1. A cheaper agent genuinely attempted the problem, and you can say what it
   concluded. "It looks hard" is not an attempt.
2. The failure is an observed behaviour, not an inference from reading code.
3. The brief lists what was already tried and ruled out, so the dispatch does
   not re-run it.
4. The blocker is reasoning, not missing context. If a `quick-read` could go and
   fetch the fact, that is the cheaper next step.

Any one of them failing points at a cheaper action. The fourth is the most
common false positive: an impasse that is really a missing file.

Its output is an analysis document. It never implements and never edits source.

## Do not delegate when

- **The edit is a single line in a single file.** Latency and briefing overhead
  outweigh the tokens saved.
- **The work needs continuous back-and-forth with the user,** or depends on this
  conversation. A subagent does not have it.
- **You are creating substantial new content from scratch.** The content exists
  only in your context, so the brief has to carry all of it. This is not the
  same as implementing a decision already made, where the brief *is* the
  decision and the agent supplies the volume.
- **Each remaining edit needs a fresh judgement call.** Keep going inline. That
  is a legitimate answer, not a failure to delegate.

Delegation is not free: the subagent re-pays its system prompt plus your brief,
and the main thread pays for the summary coming back. If writing the brief costs
more than it saves, do it yourself. Note the asymmetry though, for an
already-decided implementation the brief is short and the output is long, so
this rule points the other way.

## Before every dispatch

Run this list. Each item has a failure it prevents.

1. **Task plan exists, if the task has more than two steps.** One task per step
   with its expected output, marked done as you go. A spoken plan is dropped by
   compaction while a subagent runs; a tracked one survives.
2. **Estimate the run.** Past a few minutes, either split it into bounded
   dispatches each with an explicit file list or one concrete question, or pass
   `run_in_background: true` and tell the user in that same turn. A foreground
   dispatch dies the moment the user sends the next message. Signals that a call
   will run long: reading an entire subsystem, reviewing a full exec-plan phase,
   or a brief saying exhaustive, very thorough, the whole codebase, one by one.
3. **No blocking command anywhere in the brief.** A dev server, `tail -f`, a
   file watcher, an interactive prompt, `git rebase -i`. The command never
   returns and the agent hangs until something kills it, which from the outside
   is indistinguishable from thinking hard. If the work needs a server, say to
   start it detached and poll it, or hand that part to `devops-engineer`.
4. **The brief carries the decision, not the code.** See below.
5. **Independent parts go out in one turn,** several Agent calls in one message,
   not one at a time round-tripping.

## The brief

Send:

- The decision: the interface, the rule, the file list, the constraint.
- Known context: relevant paths, possibilities already ruled out, key symbol
  names and conventions. Let it start working instead of orienting.
- An explicit output shape: a one-line answer, a diff summary, a pass/fail.
  Say "conclusions only, no file contents" unless the user needs the detail.

Never send:

- The finished code. A brief containing it costs as many tokens as writing it
  yourself, and that is the trap that makes write delegation look useless.
- A scope you have not bounded. "Look into the auth system" comes back as a
  transcript.

Handing a write off applies **mid-task**, not only at the start. You do not have
to hand over a whole feature to hand over one implementation step. Deciding
yourself and passing the decision down is the intended use, not a compromise.

## After every dispatch, check what came back

A dispatch is not finished because it returned. Four outcomes look like success
and are not.

| What comes back | What it means |
|---|---|
| `Tool execution was interrupted`, or null | The user sent a message while it ran, so the call was killed |
| An empty final message | It crashed, ran out of turns, or had nothing it was allowed to say |
| Two lines of prose with no file, symbol or number | It never got to the work: a path it could not find, a command denied by `permissions`, a scope it declined |
| An acknowledgement from a backgrounded call | Nothing has happened yet; the result arrives later |

Then:

- **Do not re-dispatch the same brief unchanged.** An interrupted brief gets
  interrupted again; a blocked brief gets blocked again. Change the scope,
  supply the missing path, or finish it inline.
- **Respond to the user first.** They stopped it, or they are waiting on
  something that silently did not happen. Say which.
- **Never report the underlying task as done** on a result you did not receive.
  This is the failure that actually costs the user something.
- **Treat a thin return as a question, not an answer.** Go verify the one fact
  you need, or redispatch with the missing context supplied.
- **A backgrounded call is an ack.** Read the real output before making claims
  about it. And unless the call went out with `run_in_background: true`, do not
  close the turn saying you will continue once the agent finishes. Nothing will
  call you back.

Noticing that a whole chain of dispatches has quietly produced nothing is the
main thread's job. No hook does it for you.

## Red flags

Each of these thoughts is a rationalization. The right column is what is
actually true.

| Thought | Reality |
|---|---|
| "Reading these two files myself is cheaper than briefing" | Two is a guess. Count them. Past three the brief wins. |
| "Let me explore a bit first, then decide who to hand it to" | Exploring is the `quick-read` job. You need its conclusion, not its transcript. |
| "I will start delegating once implementation begins" | Planning reads more than implementing does. The largest reads are already behind you. |
| "This edit is small" | Small describes the diff, not the reading that produced it. |
| "I already know what to write, so writing it is fast" | Fast on the clock, expensive on the tier. That cost never appears in the transcript, which is why it gets missed. |
| "I will paste the code into the brief so it cannot get it wrong" | Then you paid to write it anyway. Send the interface, the rule, the file list. |
| "The agent returned, so the step is done" | Four kinds of failure look like a return. Check it. |
| "It came back thin, I will just redispatch" | The same brief fails the same way. Change the scope or supply what was missing. |
| "I will tell the user I will continue once it finishes" | Only true if it went out backgrounded. Otherwise nothing calls you back. |
| "A cheap agent would not get this right" | Say what a cheap agent actually concluded first. Until then that is a prediction, not a result. |
