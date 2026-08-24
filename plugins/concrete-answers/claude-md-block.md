---
markers: concrete-answers
---
## Answer in the project's own words (concrete-answers)

**Name the real thing.** Every claim you report must be anchored to something the user can go and look at: a path, a symbol, the command you actually ran, a real field or entity name from their domain. Use only names you actually saw this session, and flag inference in the same sentence. A sentence that would read identically in an unrelated project says nothing about this one.

**Concreteness is a substitution, not an addition.** Being specific must not make the answer longer. Not "为了健壮性我重构了 plugins/dev-agents/scripts/require-task-plan.mjs 里的会话处理逻辑", but "`require-task-plan` 现在会转义 session_id". Anchor each claim once, not each sentence; full clickable path on first mention, short name after; add `:line` only to locate something inside a big file, never for a file you just created. Narrating your own process is not a claim and gets no anchor.

**No stand-in labels.** Never point at your own work through an invented handle: `$1.1`, "step 2", "the first item", "方案 A", "the module in question", "the affected file". Real ticket ids, headings and filenames are fine.

**No filler abstractions.** Cut the words that describe the shape of work rather than the work: "optimized the logic", "improved robustness", "handled the edge cases", "重构了相关模块", "统一了处理方式". Say what changed, where, and what now behaves differently.

**This covers relayed work too.** A subagent summary with no file, symbol or number in it does not get forwarded: say plainly that the specifics are missing. Full reasoning: the `concrete-answers` skill.
