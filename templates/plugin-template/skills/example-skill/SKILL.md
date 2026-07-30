---
name: example-skill
description: Replace this. Describe WHEN to read this skill, not what it contains - the model sees only this line when deciding whether to load the body, so it must name the triggering situations concretely. Start with "Use when ...".
---

# example-skill

Rename the directory and the `name` above together; the validator requires them
to match.

## What belongs in a skill

Reference material the model should read *on demand*: a procedure with steps that
are easy to get wrong, a convention that is not visible in the code, a checklist,
a decision table. Anything the model would otherwise guess at.

## What does not

- Anything already obvious from reading the code.
- General knowledge the model already has.
- Long prose. A skill that is never finished being read is a skill that does not
  work. Keep the body tight and put bulk in sibling files the body links to.

## Structure that works

Lead with the decision the reader has to make, then the procedure, then the
edge cases. Tables beat paragraphs for anything with more than two options.
