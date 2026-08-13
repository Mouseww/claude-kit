---
markers: dev-agents
supersedes: [context-offload]
---
## Delegate to subagents by default (dev-agents)

**Default to delegation.** Route non-trivial work to a subagent rather than reading and editing inline. The main thread orchestrates and decides; subagents return compact results — conclusions, `file:line` references, a change summary — never raw file contents. Reach for it early, at every stage, not just implementation.

Delegation serves two goals (usually only one applies):

1. **Keep raw output out of the main thread.** A file dump or build log stays in the subagent's context; only the conclusion comes back. Delegate from the first exploratory read, not the first edit.
2. **Keep typing off the expensive model.** Writing code costs main-thread model time, a cost that never shows in the transcript, which is why it gets forgotten.

Route by complexity:

- Read-only search / extract / summarize, including command output -> `dev-agents:quick-read` (haiku; no Edit/Write).
- Edits that follow a rule you can state, or a change you have already decided -> `dev-agents:quick-io` (sonnet).
- Design, trade-offs, hard debugging, plan or spec review -> `dev-agents:deepthink` (opus; writes design docs and ADRs, never implements).

Role-scoped chunks, all under the same `dev-agents:` prefix: spec -> `requirements-analyst`; backend -> `backend-dev`; frontend -> `frontend-dev`; UI/UX and prototypes -> `ui-ux-designer`; tests -> `test-engineer`; code review, read-only -> `quality-reviewer`; CI/CD, deploy and migrations -> `devops-engineer`.

Vague request in, structured spec out -> `requirements-analyst`. Proposal or plan in, verdict out -> `deepthink`. When unsure, prefer the cheaper agent; it will escalate if needed.

**The write handoff, the one most often missed.** Writing out code you already understand costs more than deciding it. Hand it over instead, and brief the agent with the **decision** — the interface, the rule, the file list, the constraint — not the finished code; a brief containing the code costs as much as writing it yourself. This applies mid-task too: you do not have to hand over a whole feature to hand over one implementation step.

**Task plan before dispatching.** For tasks with more than two steps, create the task plan before dispatching any subagent, one task per step with its expected output, and mark each completed as you go. A long subagent run plus context compaction can discard a plan that exists only in the conversation.

**Bound the run, or background it.** A foreground dispatch dies the moment the user sends the next message; what comes back is interrupted, not paused. Estimate before dispatching: past a few minutes, split into bounded dispatches or pass `run_in_background: true` and say so that turn. Treat interrupted or null as failure: never redispatch the same brief, and never promise to continue once the agent returns unless it is actually backgrounded.

Rules: run independent subtasks in parallel (several Agent calls in one message); give each subagent enough context to start cold; ask for conclusions plus `file:line` refs, not raw file contents; never re-read a file you just edited.

Delegation is not free: the subagent re-pays its system prompt plus your brief, and the main thread pays for the summary. Skip it for a single trivial edit, tight interactive back-and-forth, fresh judgement each time, net-new content, or when reading one or two files beats writing the brief. Full policy: the `dev-agents` skill.
