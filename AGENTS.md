# Repository writing guidance

This file applies to every agent working in this repository. It routes writing work to the applicable guidance without duplicating the full style guide.

## Authority and scope

Apply guidance in this order:

1. A more specific `AGENTS.md` or explicit project or product style guide.
2. [`skills/technical-writing-core/SKILL.md`](skills/technical-writing-core/SKILL.md) for Rostrum strategy, product, Epic, task, code comments, API documentation, technical documentation, examples, commands, and Markdown.
3. The [Google developer documentation style guide](https://developers.google.com/style) and its [word list](https://developers.google.com/style/word-list).
4. Merriam-Webster, The Chicago Manual of Style, or the Microsoft Writing Style Guide for questions not answered above.

Project-specific rules can override this guidance. Keep exceptions consistent and document them when they affect future work. Prefer clarity and consistency over mechanical application of a rule that would make the content worse.

## Required loading

Before writing or editing repository documentation, code comments, API documentation, examples, commands, or Markdown, read [`technical-writing-core`](skills/technical-writing-core/SKILL.md). It identifies the document type and routes the work to the applicable files in [`agent-guides/technical-writing/`](agent-guides/technical-writing/).

These files are ordinary repository guidance documents, not nested skills or subagents. Read only the files that apply. A document can require more than one file.

At minimum:

1. Identify the reader, task, document type, and expected outcome.
2. Inspect the nearest project-specific guidance and neighboring documents.
3. Verify technical claims against the code, tests, command output, or an authoritative source.
4. Describe current behavior as the subject of the writing. Do not narrate a diff or the agent's work.
5. Read the applicable specialist guidance before editing.
6. Read [`review.md`](agent-guides/technical-writing/review.md) before presenting the change.

Do not add a preface such as "Here is an overview" or a generic offer to continue. Start with the information the reader needs.
