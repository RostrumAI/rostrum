---
name: technical-writing-core
description: Apply repository and Google-derived style guidance to technical writing, code comments, API documentation, examples, commands, and Markdown.
---

# Technical writing core

Use this skill for Rostrum strategy, product, Epic, and task documentation, as well as code comments, API documentation, technical documentation, examples, commands, and Markdown.

## Authority

Apply guidance in this order:

1. A more specific `AGENTS.md` or explicit project or product style guide.
2. This skill and the applicable files in `agent-guides/technical-writing/`.
3. The [Google developer documentation style guide](https://developers.google.com/style) and its [word list](https://developers.google.com/style/word-list).
4. Merriam-Webster, The Chicago Manual of Style, or the Microsoft Writing Style Guide for questions not answered above.

A project rule can override this guidance. Keep an exception consistent and document it when it matters. These are judgment-based guidelines, not a mechanical linter: choose clarity and consistency over a rule that would make the content worse.

## Before writing or editing

1. Identify the reader, task, document type, and expected outcome.
2. Read the nearest project-specific guidance and inspect neighboring documents.
3. Decide whether the content is a procedure, concept explanation, reference entry, example, changelog, or code comment.
4. Read the applicable guidance files from the routing table below before editing.
5. Verify technical claims against the code, tests, command output, or an authoritative source.
6. Describe current behavior as the subject of the writing. Do not narrate a diff or the agent's work.

## Routing table

Read only the files that apply. A document can require more than one file.

| Task or content | Read |
| --- | --- |
| Tutorial, quickstart, setup guide, or runbook | `agent-guides/technical-writing/procedures.md` |
| Public API, exported symbol, or code comment | `agent-guides/technical-writing/api-reference.md` |
| Code sample, shell command, terminal transcript, or configuration example | `agent-guides/technical-writing/code-samples-and-cli.md` |
| Markdown structure, headings, lists, tables, or inline formatting | `agent-guides/technical-writing/markdown-structure.md` |
| Sentence-level prose, grammar, requirements, jargon, or third-party material | `agent-guides/technical-writing/language-and-grammar.md` |
| Punctuation or sentence-end formatting | `agent-guides/technical-writing/punctuation.md` |
| Dates, times, numbers, phones, units, or mathematical notation | `agent-guides/technical-writing/dates-numbers-and-units.md` |
| Examples, figures, images, footnotes, notices, audio, video, or animation | `agent-guides/technical-writing/formatting-organization.md` |
| Link or cross-reference | `agent-guides/technical-writing/links-and-cross-references.md` |
| UI instructions, HTML, image, diagram, table, form, or interactive element | `agent-guides/technical-writing/accessibility.md` |
| HTML, semantic markup, CSS, or Markdown-versus-HTML decisions | `agent-guides/technical-writing/html-and-markdown.md` |
| Public-facing, translation-sensitive, or people-focused prose | `agent-guides/technical-writing/inclusive-and-global-language.md` |
| Product claim, security claim, performance claim, or release-related language | `agent-guides/technical-writing/claims-and-timelessness.md` |
| Terminology, abbreviation, product name, or word-choice uncertainty | `agent-guides/technical-writing/terminology.md` |
| Filename, example data, trademark, or naming question | `agent-guides/technical-writing/names-and-naming.md` |
| Explicit Google source lookup or category coverage | `agent-guides/technical-writing/official-index.md` |
| Review or final pass | `agent-guides/technical-writing/review.md` |

For example, a setup guide containing shell commands requires both `procedures.md` and `code-samples-and-cli.md`. A review may require `review.md` plus any specialist files implicated by the document.

## Shared baseline

- State the purpose, behavior, or outcome first.
- Use direct, concise, factual, and respectful language.
- Prefer active voice, present tense, and clear subject-verb-object order.
- Address the reader as `you` for instructions. Use third person for software behavior.
- Use `must` for requirements, `can` for ability or permission, `might` for possibility, and explicit recommendation language for optional advice. Do not use `should` when it makes a requirement ambiguous.
- Define unfamiliar abbreviations on first use when the audience might not know them. Avoid `i.e.`, `e.g.`, `aka`, `etc.`, and `and/or` in normal prose.
- Prefer simple, literal words. Remove filler, vague modifiers, idioms, slang, metaphors, hype, and unexplained jargon.
- Avoid exclamation marks, emojis, fake conversational openers, and generic conclusions in technical prose.
- Keep terminology, capitalization, and formatting consistent.
- Scope performance, cost, security, and comparison claims so they remain verifiable.
- Do not add announcements, future promises, or release claims to timeless product or reference documentation.
- Do not add a preface, generic conclusion, rhetorical hook, or offer to continue.

## Rostrum-specific writing

Apply these rules to Rostrum strategy, product, blueprint, plan, Epic, and task documents:

- Describe Rostrum as a platform for defining and executing workflows. Prompt intake, workflow selection, and AI authorship are capabilities a workflow may implement, not inherent platform behavior.
- State what the document creates, changes, establishes, or proves before explaining the details.
- Define scope primarily by stating what the document delivers. State a boundary only when a reasonable reader might otherwise infer a materially different product or body of work.
- Translate abstract capabilities and contracts into concrete questions, operations, and observable end states.
- Name the artifact or behavior directly. Avoid abstract verbs such as `support`, `enable`, `establish`, or `publish` without saying what is produced.
- Prefer short sections, tables, bullets, and diagrams only when they clarify a relationship better than prose.
- Use tables for ordered delivery, comparisons, ownership, dependencies, and `what / why / proof` views.
- Keep table rows concrete and independently understandable. Organize plans in priority and dependency order.
- Link product-plan milestones to Epics. Make the connection evident from the structure instead of asserting it in explanatory prose.
- Match detail to the document: a blueprint defines product shape and boundaries; a product plan defines delivery milestones and proof; an Epic defines a product state and delivery work; a task defines one bounded piece of work and its acceptance criteria.
- Do not use a higher-level document as a substitute for a lower-level document.
- Treat example workflows as evidence of platform completeness and requirements, not as the product definition. State what each showcase proves and needs instead of narrating it step by step.
- Use `workflow`, not `mode`, for a unit that defines and executes behavior. Use music-related names only when their meaning is immediately clear.
- Do not create packaging or distribution concepts prematurely. Record a future decision without designing it when it is not in scope.

## Final pass

Read `agent-guides/technical-writing/review.md` before presenting a documentation change or review. Fix applicable failures instead of noting them for later.
