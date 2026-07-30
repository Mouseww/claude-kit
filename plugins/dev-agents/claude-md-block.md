---
markers: dev-agents
supersedes: [context-offload]
---
## Delegate to subagents by default (dev-agents)

**Default to delegation.** On a non-trivial task, route the work to a subagent rather than reading and editing inline. The main thread orchestrates and decides; subagents do the work in their own context and return a compact result — conclusions, `file:line` references, a change summary — never raw file contents. This is the main lever that keeps a long task's context lean, so reach for it early, at every stage of a task rather than once implementation starts. The exceptions at the end are real, but they are exceptions.

Delegation serves two separate goals. Most work triggers only one:

1. **Keep raw output out of the main thread.** Applies to reads: a file dump or a build log stays in the subagent's context and only the conclusion comes back. The heaviest reading is usually in clarifying the ask, brainstorming and planning, so delegate from the first exploratory read, not the first edit.
2. **Keep typing off the expensive model.** Applies to writes: a read costs context, but writing code costs model time on whatever tier the main thread is running. That cost never shows up in the transcript, which is why it is the one that gets forgotten.

Route by complexity:

- Read-only search / extract / summarize -> `dev-agents:quick-read` (haiku; no write access, no Bash).
- Edits that follow a rule you can state, or a change you have already decided -> `dev-agents:quick-io` (sonnet).
- Design, trade-offs, hard debugging, plan or spec review -> `dev-agents:deepthink` (opus; writes design docs and ADRs, never implements).

Role-scoped chunks, all under the same `dev-agents:` prefix: spec -> `requirements-analyst`; backend -> `backend-dev`; frontend -> `frontend-dev`; UI/UX and prototypes -> `ui-ux-designer`; tests -> `test-engineer`; code review, read-only -> `quality-reviewer`; CI/CD, deploy and migrations -> `devops-engineer`.

**The write handoff, the one most often missed.** Once you know what the code should be, writing it out is the expensive part, not the deciding. If you are about to type a substantial change you already understand, hand it over instead, and brief the agent with the **decision** — the interface, the rule, the file list, the constraint — not the finished code. A brief containing the code costs as much as writing it yourself. This applies mid-task, not only at the start: you do not have to hand over a whole feature to hand over one implementation step.

**Task plan before dispatching.** When a task has more than two steps, create the task plan before dispatching any subagent, with a task per step describing the work and its expected output, and mark each completed as you go. A long subagent run plus context compaction can discard a plan that exists only in the conversation.

Rules: run independent subtasks in parallel (several Agent calls in one message); give each subagent enough context to start cold; ask for conclusions plus `file:line` references rather than raw file contents; never re-read a file you just edited.

Delegation is not free: the subagent re-pays its own system prompt plus whatever you hand it, and the main thread still pays for the summary coming back. Skip it for a single trivial edit, a tight interactive back-and-forth with the user, edits that each need a fresh judgement call, creating substantial new content from scratch, or anything where reading one or two files is cheaper than writing the brief. Full policy: the `dev-agents` skill.
