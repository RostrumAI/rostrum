---
name: fix-writing
description: Rewrite one or more existing repository documentation files for clearer terminology, first-use definitions, Google-aligned style, and natural human prose while preserving every technical claim and decision. Use only when substantive documentation files already exist; never use to draft a new document or complete an empty scaffold.
---

# Fix writing

Use this skill to improve existing documentation without changing what it says. The skill runs one independent worker subagent for every input file. Each worker edits a temporary clone, verifies it against the original, and replaces the original only after every file-level check passes.

## Invocation contract

The invocation must provide one or more explicit repository-relative paths to existing documentation files.

A valid input file must:

- exist inside the repository;
- be a regular, readable text file;
- contain substantive prose that already communicates the intended technical ideas;
- be distinct from every other input after resolving its real path;
- not be a temporary artifact created by this skill.

This is a rewrite skill. Do not use it to create documentation from scratch, turn an outline into a document, fill an empty template, invent missing sections, or decide technical content that the source does not contain.

Stop before spawning any worker when an input is missing, duplicated, outside the repository, binary, empty, or too incomplete to preserve meaning. Report the invalid path and reason. Do not silently process only the valid subset.

## Coordinator workflow

### 1. Preflight every input

Resolve and validate all paths before editing anything. Reject two paths that resolve to the same file.

For each valid file, derive two unique hidden sibling paths that preserve the document extension:

- temporary document clone: `.<stem>.fix-writing.document<extension>`;
- temporary dictionary: `.<stem>.fix-writing.dictionary.md`.

For example, `docs/guide.md` uses `docs/.guide.fix-writing.document.md` and `docs/.guide.fix-writing.dictionary.md`.

Stop if either temporary path already exists. Never overwrite an artifact from another invocation.

### 2. Create one worker per file

Use the `task` tool to create exactly one general-purpose worker subagent for each validated input file. Do not create planning, research, review, or integration subagents. Workers must not delegate further.

Submit independent workers in one `tasks[]` batch when there are at most 32 files. For more than 32 files, use waves of at most 32 while preserving the one-worker-per-file rule.

The shared task context must use this contract:

```text
# Goal
Rewrite each assigned existing document for clearer terminology, Google-aligned technical style, and natural human prose without changing meaning.

# Constraints
One worker owns one original file and its two named temporary files. Workers do not edit other paths, delegate, run project-wide formatters, or run build, lint, or test suites. All prose edits happen on the temporary document clone. The original stays unchanged until the worker completes file-level verification.

# Contract
Each worker follows skill://fix-writing/worker.md in worker mode. It creates and later removes its temporary dictionary, verifies semantic preservation against the original, replaces the original only after every check passes, and reports concrete verification evidence.
```

Each task must use this shape and include the exact paths:

```text
# Target
Original: <repository-relative path>
Temporary document: <repository-relative path>
Temporary dictionary: <repository-relative path>
Do not change any other file. Work as a per-file worker and do not spawn subagents.

# Change
Read skill://fix-writing/worker.md and execute the complete per-file worker procedure. This is an existing-document rewrite, not document creation.

# Acceptance
The original is replaced only by a verified temporary clone that preserves every claim, requirement, technical idea, example, identifier, number, citation, and link. The two temporary files no longer exist. Report the terminology decisions, style passes, semantic comparison, structural checks, and cutover verification. Skip project-wide formatters, builds, linters, and tests.
```

### 3. Collect worker results

Wait for every worker. A completed worker job is not proof that its output is acceptable. Check each result for the evidence required by the task contract.

If a worker reports an ambiguity that requires a product or technical decision, obtain that decision before asking the same worker to continue. Do not let the worker guess or weaken the original statement.

### 4. Perform coordinator checks

After all workers finish:

- confirm that every original path still exists;
- confirm that no temporary document or dictionary path remains;
- run any applicable repository documentation check once, not once per worker;
- report success or failure separately for every input file.

Do not claim success for a file whose worker skipped cutover, found a concurrent edit, or could not prove semantic preservation.

## Nonnegotiable invariants

- Preserve meaning before improving style.
- Do not add facts, claims, names, numbers, dates, citations, rankings, requirements, or promises.
- Do not remove qualifications, boundaries, rationale, examples, failure cases, or provisional status.
- Preserve the force of requirements and recommendations.
- Treat code identifiers, API names, filenames, paths, commands, URLs, link targets, UI labels, quotations, code blocks, and frontmatter as exact content unless the source itself proves they are wrong.
- Never edit the original document before the temporary clone passes final verification.
- Never leave an original path missing after cutover.
