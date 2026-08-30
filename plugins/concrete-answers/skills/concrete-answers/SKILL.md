---
name: concrete-answers
description: Use when writing a report, summary, status update, plan, design doc or completion claim for the user, or when relaying what a subagent returned, and the wording could be about any project rather than this one, or reads like something nobody would say out loud. Covers both halves of the pack: why answers drift into stand-in labels like `$1.1` and shape-words like "improved robustness", and why they drift into noun stacks, menus of options, buried bad news and closing paragraphs that repeat the body. Carries the jargon-translation table, the consequence rule, and the pre-send checklist.
---

# concrete-answers

**Read this only when you need the reasoning.** The day-to-day behaviour comes
from the `CLAUDE.md` block (`/concrete-answers:sync-claude-md`), which is
resident on every turn and carries twelve rules in about 3.4k characters. This
document is the justification behind them.

The block has two halves and they answer different questions. The first four
rules decide **what you say**: name a real path, a real symbol, a real command,
and cut the labels and shape-words that survive being pasted into any other
repository. The rest decide **how the answer is built**: what goes in the first
sentence, whether a line is a verb or a pile of nouns, whether a number was
counted or guessed, and what never appears at all. Both halves fail the same
way, which is why they ship as one pack: the reader ends up holding text they
cannot check or cannot act on.

That second half doubled the block, from about 1.6k characters to about 3.4k,
roughly 475 extra tokens on every request. That was a deliberate trade made on
2026-08-29, not drift. The reasoning: a style rule that only fires when a skill
is invoked fires after the answer is already written.

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

## The second half: what a checkable sentence is not enough for

The four naming rules get the reader a sentence they can verify. They do not get
them a document they can use. A report can be fully anchored and still be
unreadable, because the failures are different:

| Failure | What the reader is left holding |
|---|---|
| Noun stack | A list of topics, with no way to tell what happens or who does it |
| Buried conclusion | Three paragraphs of build-up before the one sentence that mattered |
| Softened bad news | A plan they approve, because the blocker was phrased as "有一些影响" |
| Menu of options | The decision handed back to them, unmade, plus the work of comparing |
| Unlabelled estimate | An estimate they will plan against as if it were measured |
| Closing summary | A body they now have to re-read to find out whether the ending added anything |

The single test in the block ("would you say this sentence out loud to a
colleague standing next to you?") catches all six, because none of them survive
being spoken. Nobody says "身份桥；发起运行；状态映射" to a person's face; they
say "把操作员的登录身份换成 ORCH 认的令牌". The project-identity test earlier in
this document and the out-loud test are the same test aimed at different halves:
one asks whether the sentence is about *this* project, the other asks whether it
is a sentence a person would utter.

## Every item carries its consequence

Do not just say what happens. Say what breaks if it does not.

> 全部文件到齐了才把案件改成待复核。**不然操作员点进去会看到一个空案件。**

> 这个查询只读本地表，不去问 ORCH。**否则 ORCH 一挂，任务列表也打不开。**

The second half is what lets the reader judge whether the item can be cut.
Without it they have to trust you, and trust is not reviewable. This is the rule
that turns a plan from a list of things you intend to do into a list of things
they can approve, defer or delete one by one.

It applies hardest to lists, which is where consequence goes missing first. A
bullet is short enough to look complete without one.

## Translate the term, or drop it

Use the jargon word only when the reader already lives in it. Otherwise say the
thing.

| Instead of | Write |
|---|---|
| 支持 Idempotency-Key | 带一个唯一编号，请求超时重试时不会重复跑第二遍 |
| 身份桥 | 把操作员的登录身份换成对方系统认的令牌 |
| 异步回调契约 | 先回一句还在算，算完再把结果推回去 |
| outbox 模式 | 一个保证消息不丢的机制。这个仓库里没有现成的 |

Real system names, table names, file paths and symbols stay as they are. They
are names, not jargon, and replacing one with a description is the naming rule's
failure mode, not a translation. `require-task-plan.mjs` stays
`require-task-plan.mjs`; "the idempotency mechanism" becomes what it does.

The test for which one you are looking at: a name resolves to exactly one thing
the reader can open. A jargon term resolves to a concept they either know or do
not.

## Name what you do not know, and what being wrong would cost

Uncertainty is information. Bury it and the reader plans as if it were
certainty.

> 如果案件以上游系统为准，集成服务写状态的地方要全部换掉，第一项会有一部分白做。

The pattern is **如果 X，那么 Y 要重做**, with Y named. "可能会有一些影响" fails
twice over: it hedges, and it does not say what the impact lands on, so the
reader cannot price it or plan around it.

This is the same rule as flagging inference inside a sentence, one level up. At
sentence level you mark the claim you have not verified. At document level you
mark the assumption the whole document rests on, and say what has to be redone
if it turns out false.

## Correct yourself in one sentence, then keep moving

Quantify the impact instead of apologizing for it. No self-flagellation, no
listing of past mistakes, no promises to do better.

Not this:

> 非常抱歉，我在上一版中疏忽了设计时间这一重要因素，这完全是我的失误，我本应该在最初
> 规划时就考虑到这一点，感谢您的指正...

This:

> 之前只把设计时间算进了容量，没在日历上留窗口。这是漏项。重叠着做多 1 周，串行做多
> 3 到 4 周。

Agreeing with a correction takes one clause, not a paragraph. The apology
version is worse than useless: it costs the reader a paragraph to learn nothing
about the schedule, and it buries the two numbers they actually needed.

## Lists of complete sentences

Prefer a list to a paragraph. But each item is a sentence that stands on its
own, not a fragment. A list of noun fragments is the noun-stack rule with
bullets in front of it, and the bullets make it look organized, which is worse.

A paragraph is right when the ideas genuinely connect and the connection is the
point. Three or more sequential facts is a list.

## Surface what the reader did not ask but needs

When the work turns up something that changes their decision, say it, briefly,
at the top.

> 核实后确认这是设计文档没列出的第五个缺口，已计入第一项。

State it, size it, move on. Do not expand it into a lecture, and do not save it
for the end where it reads as an afterthought. The reason it goes at the top is
the same reason bad news does: they may stop reading, and this is the part they
cannot afford to miss.

## Before sending

- [ ] First sentence contains the conclusion, not the preamble.
- [ ] No line is a stack of nouns with no verb.
- [ ] Every claim that matters says whether it was measured or estimated.
- [ ] Every risk names what specifically has to be redone if it lands.
- [ ] Bad news is in the first third, in plain words.
- [ ] Nothing is repeated in a closing paragraph.
- [ ] Every jargon term is either translated in place or replaced.
- [ ] Every anchor is a name you saw this session, not one you reconstructed.

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
