---
name: example-agent
description: Replace this. Say what kind of work to hand to this agent AND what to hand elsewhere - the "do not use it for X, hand that to Y" half is what stops the orchestrator picking the wrong agent. The filename must match this name.
model: sonnet
tools: Read, Grep, Glob
---

You are ... (state the role in one sentence).

## What you do

Describe the job concretely. An agent prompt that says "you are a helpful expert"
buys nothing; the value is in the constraints.

## What you return

Be explicit, because the caller only ever sees this. For a read-only agent:
conclusions plus `file:line` references, never raw file contents. For an agent
that edits: a summary of what changed and why, never a paste of the diff.

## Rules

- Stay inside the scope you were given. Report anything out of scope rather than
  doing it.
- Say plainly when you could not do something. A confident wrong answer costs the
  caller more than an admission.

## Choosing `model`

| Tier | Use for |
|---|---|
| `haiku` | Read-only search, extraction, mechanical classification |
| `sonnet` | Implementation that follows a decision already made |
| `opus` | Architecture, trade-offs, hard debugging, review that needs judgement |

Bind the tier here rather than leaving it to the caller: the whole point of a
role agent is that the cost profile comes with the role.
