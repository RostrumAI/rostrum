# Fix-writing worker procedure

You are one per-file worker. Process only the original document and the two temporary paths named in your task. Do not spawn subagents, edit another file, or run project-wide formatters, builds, linters, or tests.

## 1. Protect the original

Before changing prose:

1. Confirm that the original is an existing, substantive documentation file. It must contain enough prose to preserve the author's intended meaning. Do not turn an outline, empty template, or placeholder into a new document.
2. Read the complete original, including frontmatter, tables, examples, code blocks, footnotes, and link definitions.
3. Record the original file's content hash, byte length, permissions, and line-ending style.
4. Create the named temporary document as a byte-for-byte clone of the original.
5. Verify that the clone's hash and byte length match the original.

All edits happen on the temporary document. Do not touch the original until the cutover step.

If the input is not a substantive existing document, delete any temporary artifact you created and report that this skill cannot create the document from the beginning.

## 2. Identify the reader and document contract

Determine the document's intended reader, task, document type, and expected outcome from its content, location, project guidance, and neighboring documents.

Use an explicit audience statement when the document provides one. Otherwise, assume a junior software engineer who knows common software concepts and is vaguely familiar with the repository's product and core vocabulary. Do not assume knowledge of internal architecture, uncommon domain language, project-specific overloaded terms, or implementation details.

Record this audience baseline at the top of the temporary dictionary. The baseline controls which terms qualify for inclusion.

Before rewriting, identify the information that must survive:

- factual and technical claims;
- decisions, requirements, recommendations, and their strength;
- scope boundaries, qualifications, caveats, and provisional status;
- rationale and comparisons;
- examples, failure cases, and acceptance criteria;
- names, numbers, dates, identifiers, citations, links, and references;
- code spans, code blocks, commands, paths, API names, UI labels, and frontmatter.

Do not resolve an unclear technical statement by guessing. If improving the prose requires a product or engineering decision that the source does not provide, stop before cutover and report the exact ambiguity.

## 3. Create the temporary dictionary

Create the named temporary dictionary from the original document before rewriting the clone. Use the method in repository-root `RULES.MD`, generalized as follows.

A term belongs in the temporary dictionary only when all of these conditions are true:

1. The exact term or phrase appears in the original document.
2. The intended reader is unlikely to know it from the audience baseline.
3. The surrounding text does not already provide a concise, sufficient definition at first substantive use.
4. Misunderstanding the term would materially impair the reader's understanding of the document.
5. The term cannot be explained more clearly as part of another entry.

A familiar term can qualify when the document uses it in a materially narrower or different sense and does not make that difference clear at first use.

Exclude:

- ordinary software terminology covered by the audience baseline;
- core product, repository, or planning vocabulary covered by the audience baseline;
- a term merely because the repository gives it a precise implementation definition;
- a code identifier when a linked source or included conceptual term already explains it;
- aliases or closely related phrases that one entry can cover;
- terms introduced only by the dictionary and absent from the original;
- terms already defined sufficiently at first use.

When a term is borderline, exclude it. This dictionary is a focused editing aid, not a complete glossary.

Use this temporary format:

```markdown
# Temporary dictionary for `<original path>`

Intended reader: <one sentence>
Assumed knowledge: <one sentence>

## <exact term or phrase>

Meaning: <one concise, context-specific definition>
First substantive use: <heading and original line number or another precise location>
Treatment: <rename to "..." | retain and define as "...">
```

Keep entries alphabetical. Use one entry for close aliases. Every treatment must be actionable.

The default treatment for an unfamiliar prose term is a clear plain-language replacement. Retain the original term only when renaming it would reduce precision or alter exact content, such as a standard term, public name, code identifier, API element, filename, command, UI label, quotation, or cross-document contract term. A retained term requires a first-use definition.

## 4. Repair terminology on the clone

Compare the complete temporary document with every dictionary entry.

For an entry marked `rename`:

- replace the confusing prose term with its plain-language name everywhere the same concept appears;
- use one replacement consistently instead of cycling synonyms;
- preserve technical distinctions and requirement strength;
- do not rewrite exact content in code spans, code blocks, frontmatter, commands, paths, URLs, link destinations, UI labels, proper names, or quotations.

For an entry marked `retain and define`:

- keep the exact term;
- define it at its first substantive prose occurrence;
- use a short appositive, parenthetical, or adjacent sentence that fits the paragraph;
- do not repeat the definition at later occurrences.

A title, table of contents, heading, code sample, or link label does not count as a first substantive prose occurrence. Put the definition in the first explanatory paragraph that uses the term.

After the terminology pass, scan the clone again. If an edit introduced unfamiliar jargon, replace it with familiar wording. Do not add a term to the temporary dictionary merely to legitimize jargon that was absent from the original. Every retained unfamiliar source term must be explained at first substantive use.

Do not rename headings, public terms, or other text that acts as a cross-document link target unless all references can be preserved within the assigned file. Retain and define the term when a rename could break external references.

## 5. Apply the repository technical-writing guides

Apply the Google-derived guidance cloned under `agent-guides/technical-writing/` to the temporary document.

1. Read `skills/technical-writing-core/SKILL.md`.
2. Use its routing table to read every guide that applies to the document type and content.
3. Read `agent-guides/technical-writing/review.md` for the final style pass.
4. Follow more specific project guidance when it overrides the general guide.

At minimum, review terminology, language and grammar, Markdown structure, punctuation, links, accessibility, inclusivity, and claim wording when the document contains those concerns. Read procedure, API reference, code sample, naming, formatting, or numerical guidance when the document includes that material.

Apply the guidance to prose and structure without changing technical content. Preserve exact syntax in examples, commands, identifiers, links, and code. Verify a proposed factual correction against repository code, tests, command output, or an authoritative source before making it. If no source supports the correction, preserve the original claim.

## 6. Apply the humanizer guide

Read the complete `agent-guides/humanizer/humanizer-guide.md` and apply it to the temporary document in file mode.

Run its draft, audit, and final loop internally:

1. Identify concrete AI-writing patterns in the clone.
2. Produce the humanized draft on the temporary document.
3. Ask internally: "What makes the below so obviously AI generated?"
4. Ask internally: "Does the rewrite state any fact, name, number, date, quote, citation, or ranking that isn't in the source, or drop a claim that was?"
5. Revise the temporary document to fix every supported finding.

Preserve the document's existing human voice. For technical, legal, reference, and planning documents, neutral and plain prose is the correct human voice. Do not add personality, opinions, anecdotes, or factual detail that the source does not contain.

Leave frontmatter, data, code blocks, exact identifiers, link targets, and quoted source text unchanged. Apply language-specific rules from the guide when the document is not English.

## 7. Verify the temporary document

Verification happens before cutover and compares the finished temporary document with the untouched original.

### Semantic preservation

Confirm that the clone preserves every item identified in the document contract. Check each original claim, decision, requirement, recommendation, boundary, qualification, rationale, example, and failure case against the clone.

Check exact content separately:

- names, numbers, dates, identifiers, and status values;
- requirement words and their force;
- citations, relative links, URLs, and link destinations;
- code spans, code blocks, commands, paths, API names, UI labels, and frontmatter.

The clone must contain no invented claim and omit no source claim. Reordering, splitting, merging, or compressing prose is acceptable only when all meaning survives.

### Terminology

Confirm that:

- every temporary dictionary entry is either renamed consistently or retained with a first-use definition;
- no necessary unfamiliar term remains unexplained;
- the clone introduces no unexplained jargon;
- no exact identifier or linked name was changed as ordinary prose;
- the temporary dictionary is not linked from or copied into the finished document.

### Writing quality

Apply the checklist in `agent-guides/technical-writing/review.md`. Then repeat the humanizer audit against the finished clone. Fix supported issues rather than listing them for later.

### Document integrity

Confirm that:

- the heading hierarchy is valid;
- lists, tables, notes, and code fences remain structurally complete;
- relative links and referenced repository paths resolve;
- frontmatter and document-specific syntax remain valid;
- line endings and file permissions can be preserved at cutover;
- the original file's current hash still matches the hash recorded before cloning.

Use file-level inspection and checks only. Do not run project-wide formatters, builds, linters, or tests inside the worker.

If a verification fails, revise the temporary document and repeat the affected checks. Do not cut over with an unresolved failure. If the failure cannot be resolved without changing meaning or inventing information, delete both temporary files, leave the original untouched, and report the blocker. If the original changed after cloning, perform the same cleanup and report a concurrent-edit conflict.

## 8. Replace the original and clean up

After every verification check passes:

1. Record the verified temporary document's hash and byte length.
2. Reconfirm that the original hash still matches the initial snapshot.
3. Preserve the original file permissions and required line-ending style on the temporary document.
4. Replace the original path with the temporary document in one atomic rename when the filesystem permits it. This removes the old original and places the verified clone at the original path without an interval where the path is missing.
5. Delete the temporary dictionary.
6. Confirm that the original path exists and matches the verified hash and byte length.
7. Confirm that neither temporary path remains.

If safe replacement cannot be completed, keep or restore the original at its path, delete temporary artifacts, and report failure. Never leave the repository with a missing original or an unverified clone at the original path.

## Worker result

Return a concise result containing:

- the original file path;
- the number of temporary dictionary terms renamed and retained;
- the technical-writing guides applied;
- the semantic-preservation checks performed;
- the structural and link checks performed;
- the humanizer audit result;
- the final content hash;
- confirmation that cutover succeeded and temporary files were removed.

Do not return the temporary dictionary or intermediate rewrite unless the coordinator requests failure diagnostics.
