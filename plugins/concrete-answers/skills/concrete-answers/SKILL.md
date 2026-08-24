---
name: concrete-answers
description: Use when writing a report, summary, status update, plan or completion claim for the user, or when relaying what a subagent returned, and you notice the wording could be about any project rather than this one. Explains why answers drift into stand-in labels like `$1.1` and shape-words like "improved robustness", the one test that catches both, why being specific must not make the answer longer, what to do when the specifics genuinely are not available, and where abstraction is legitimate.
---

# concrete-answers

**Read this only when you need the reasoning.** The day-to-day behaviour comes
from the `CLAUDE.md` block (`/concrete-answers:sync-claude-md`), which is
resident on every turn and carries the five rules in about 1.6k characters. This
document is the justification behind them.

The block deliberately keeps every *sample* (the banned labels, the banned
shape-words, the before/after pair) and pushes every *rationale* here. Samples
are what make the rule fire: a model does not recognize its own filler from an
abstract prohibition, it recognizes it from seeing "improved robustness" written
out. Rationales only matter when you are deciding an edge case, which is exactly
when a skill gets loaded. Do not "compress" the block by deleting its examples.

## The complaint this pack exists for

Two failures, reported together, because they have the same root:

1. Answers point at work through labels the user never wrote: `$1.1`,
   "step 2", "the second option", "the module in question".
2. Answers describe the *shape* of work instead of the work: "refactored the
   relevant module", "improved robustness", "unified the handling".

Both produce text that is locally fluent and globally useless. The user cannot
check either one. A label they never saw resolves to nothing on their side, and
a shape-word survives being pasted into any other codebase, which is exactly
what makes it empty.

## Why it happens

Not laziness. Three specific mechanisms:

- **Compression under pressure.** Long turns push toward shorter references, and
  the shortest available reference to "the change in
  `plugins/dev-agents/scripts/require-task-plan.mjs`" is "that file". Once one
  sentence does it, the rest follow, and by the end of the message nothing has a
  name.
- **Relaying instead of reporting.** A subagent returns "updated the affected
  modules and improved error handling". Forwarding it is one token cheap and
  reads like a finished report. The specifics were never in the main thread to
  begin with, so nothing feels missing while writing.
- **Hedging.** When confidence in a detail is low, a vague noun avoids being
  wrong. "The config file" cannot be falsified; `settings.local.json:12` can.
  The vagueness buys safety at the cost of the whole point of the sentence.

The third one deserves the direct answer: an unverifiable sentence is not safer
than a wrong one, it is worse, because a wrong path gets corrected in one round
trip while a vague one gets believed.

## The test

One check, applied per sentence:

> Would this sentence read exactly the same if it were about a different project?

If yes, it carries no information about *this* one. Fix it by adding the thing
the sentence is actually about: a path, a line, a symbol, a command, a table or
field name, a number.

A second check for labels specifically:

> Can the user resolve this reference without asking me what it means?

`docs/exec-plan.md` heading "Phase 2", ticket `KIT-114`, "the `markers`
frontmatter key": resolvable. `$1.1`, "the first approach", "as discussed
above": not resolvable, or resolvable only by re-reading the transcript, which
is the cost you are supposed to be saving them.

## The rule that keeps this pack from backfiring

Being specific must not make the answer longer. This is not a politeness
concession, it is what the rule is actually asking for: a vague sentence is not
bad because it is short, it is bad because its whole length is wasted. The fix
is a **swap**, not an **addition**. "增强了健壮性" and "空 `customer_id` 现在返
422" cost about the same; one is checkable.

The failure mode when this is left implicit:

- The same full path written three times in one paragraph, because the rule said
  to name the real thing and said nothing about naming it once.
- `file:line` on a file that was just created, where the line number locates
  nothing and is stale the next time anyone edits above it.
- Every intermediate step narrated with its own anchor, so the actual answer is
  buried in a transcript of how it was found.

So three mechanical carve-outs, all in the block:

1. **One anchor per claim, not per sentence.** A claim is something the user
   might verify or act on: what changed, what broke, where a number came from,
   what a command returned. Process narration is not a claim.
2. **Full path on first mention, short name after.** This repo's own prose
   already works this way: in the `dev-agents` skill,
   `scripts/require-task-plan.mjs` appears in full exactly once and the bare
   `require-task-plan` carries the other three references. Copy that.
3. **`:line` only to locate.** Use it to point into a big file. Skip it for a
   new file, a whole-file rewrite, or anything the reader will open at the top
   anyway. Line numbers rot faster than any other kind of anchor.

## Only name what you have seen

The block compresses this to one clause; the reasoning is that a fabricated
anchor is strictly worse than an abstraction. "The config file" is merely
uninformative. `settings.local.json:12`, when you never opened it, is a specific
claim that sends the user to a line that may not exist, and it spends the
credibility that every other anchor in the message depends on.

So the anchor has to come from this session: a file you read, a command you ran,
output you saw. When you are working from recall or inference, the fix is one
clause in the same sentence ("I have not verified this", "from memory of the
earlier read"), not a vaguer noun. Being explicitly uncertain about a specific
thing beats being confidently vague.

## Before and after

| Vague | Concrete |
|---|---|
| "Fixed the hook so it works" | "`require-task-plan.mjs` was writing the raw `session_id` into a filename; it is now sanitized at line 169" |
| "Updated the relevant tests" | "Added case 6 to `plugins/dev-agents/tests/subagent-return.test.mjs`, covering an `interrupted: true` response that still has body text" |
| "Implemented $1.1 and $1.2" | "Added the `markers` frontmatter to the new block, and registered the pack in `.claude-plugin/marketplace.json`" |
| "Improved error handling in the API" | "`POST /orders` now rejects a missing `customer_id` with 422 instead of throwing at the DB layer" |
| "The subagent reported success" | "The subagent reported the two edits landed and `node scripts/validate.mjs` exited 0" |

Note the last row. "Reported success" and "reported X, verified by Y" differ in
whether the user can tell what was actually checked.

## When abstraction is legitimate

This is not a rule against ever generalizing.

- **The user's own vocabulary.** If they say "the login flow", use "the login
  flow". Matching their term is concrete; inventing a synonym is not.
- **Real, shared identifiers.** Ticket ids, exec-plan phase names, ADR numbers,
  test case names. These resolve on the user's side. Spell out what one refers
  to on first use in a message, then the short form is fine.
- **A genuine summary line above the detail.** "Three changes, all in the
  `dev-agents` pack:" followed by the three named changes is good structure. The
  headline is allowed to be short precisely because the detail follows.
- **Deliberate scope statements.** "I did not touch the fleet-engineering pack"
  is abstract and useful.

The line is whether a concrete referent exists somewhere in the message. A
headline with no detail under it is the failure mode; a headline introducing
detail is fine.

## When the specifics are missing

Sometimes you genuinely do not have them: a subagent returned prose, a run was
interrupted, the detail sits in a file nobody read. The move is never to write
around the gap with a shape-word. Two acceptable options:

1. **Go get it.** One `grep`, one targeted read, or one narrow re-dispatch, and
   the sentence gets a real referent. This is usually cheaper than the round
   trip caused by an unverifiable claim.
2. **Name the gap.** "The subagent says it updated the hook registration but did
   not say which entries; I have not verified it." That is concrete about the
   uncertainty, which is a different thing from being vague about the fact.

What is never acceptable is presenting a summary as a report. If a subagent's
answer has no file, symbol, count or command in it, that answer is not evidence
yet.

## Relation to the dev-agents pack

The two interlock, and the seam is drawn by **consequence**, so that either pack
is complete when installed alone:

| Moment | Owner | Rule |
|---|---|---|
| Writing the brief | `dev-agents` | Ask for conclusions plus `file:line`, never raw file contents |
| Reading the return | `dev-agents` | Interrupted, empty or suspiciously thin is a failure: verify, or redispatch with the missing context, and never build on it |
| Telling the user | this pack | A summary with no file, symbol or number is not forwarded; say the specifics are missing |

The overlap to avoid is wording, not subject matter. This pack says nothing
about verifying or redispatching, because that is an operational action
`dev-agents` already owns and its `check-subagent-return` hook already nudges.
It only governs what leaves for the user.

And if delegated work keeps coming back shape-shaped, the brief is the bug: ask
for the path and the symbol, not for a description of the work.

## What this pack does not do

There is no hook. Detecting vagueness mechanically would mean pattern-matching
assistant prose, and every cheap pattern for it (`\$\d+\.\d+`, "relevant",
"robustness") has honest uses, so the false-positive cost outweighs a reminder
the resident block already delivers on every turn. If you want it enforced,
enforce it by asking: send back "which file, which line" the moment a report
arrives without one.
