# Lens: documentation and communication

Read `reviewer-contract.md`, `rules/repository-conventions.md`, and the writing rules in the
repository's `AGENTS.md`. When reviewing delivery documents, also read the canonical writing guide,
delivery methodology, and matching blueprint or technical-design guide from `dev-docs/` when that
checkout is available. The repository rules contain the review criteria needed when it is absent;
do not invent findings about unseen parent documents or approvals.

Your angle is the prose a change carries: comments, TSDoc, READMEs, migration notes, and any
markdown in the diff. You do not hunt for defects, and you do not comment on TypeScript syntax.

## Activate when

The diff changes a `.md` file, a comment or TSDoc block, a schema description, an error message, the
text of a user-facing response, or a maintained TypeScript declaration whose required TSDoc may be
missing. Skip the lens for changes that carry neither prose nor a declaration with a documentation
requirement.

## What to check

1. **Purpose and placement.** TSDoc states what a caller needs to know in concise, plain language a
   junior engineer with Rostrum product knowledge can follow. It does not carry a dense execution
   trace. When a function has non-obvious stages, short, nearly conversational comments beside those
   stages guide the reader through the flow. A transition may name its next step as part of that
   walkthrough; an isolated paraphrase of the next statement is still a finding.
2. **Business reason and object members.** Every named property or method in an interface or object
   type literal has its own succinct TSDoc explaining what the key is for. A field, column, column
   constraint, or migration comment explains the business purpose of the change, not only its type.
3. **Accuracy.** Prose that describes behavior the code no longer has, a README whose commands no
   longer match the scripts, a doc example that would not compile or run, and a statement that
   contradicts the schema beside it.
4. **Terminology.** The repository's terms, from the current governing decisions, used consistently.
   A retired concept reintroduced under a new name, and the rejected words listed in the rules, are
   findings.
5. **Audience and level.** An Epic defines product behavior and acceptance. A high-level blueprint
   explains what to build technically, its responsibilities, interactions, reasons, and scope.
   A technical design explains how those responsibilities work in the actual repository, including
   file purposes, affected callers and contracts, state ownership, ordering, failures, and meaningful
   verification. References and setup guides use the level of detail their own readers need.
6. **Restraint.** Filler, promotional phrasing, vague attribution, narration of the editing process,
   and speculative design presented as implemented.
7. **Links.** A relative link resolves. A link to a file the change deleted or renamed is updated.
8. **Direct references.** TSDoc and comments do not cite another file by path when the file itself
   is the reader's context; state the concept instead.
9. **Exhaustive claims.** A list, table, or "all" statement in prose covers what the code actually
   enumerates, and a list that omits a case the code handles is a finding.
10. **Scope.** A change that renames or removes a behavior updates the prose that names it, in the
    same change.
11. **Delivery handoffs.** Current guidance preserves Epic → blueprint → technical design → code.
    A design links its blueprint and Epic and owns implementation checkpoints and evidence. A prior
    combined plan is not an alternate path for resumed implementation. Check the affected scope;
    do not require identical template headings or apply new formats to historical records.
12. **Explanations and evidence.** A named component or a list of files is not an interaction story.
    Identify who initiates work, what crosses the boundary, who owns the resulting state, and what
    consumes the result. Self-review claims need supporting passages, and implementation claims need
    observed evidence. Code snippets should resolve ambiguity, not replace the design explanation.

## How to work

Read the changed prose against the code it describes. The finding is the disagreement or concrete
reading burden, not phrasing you would merely choose differently. For readability findings, name the
burden: caller-facing TSDoc mixed with execution details, an unexplained transition, a dense sentence,
or a documented key whose purpose remains unclear.

Do not report length or voice on taste alone.

Report `REPO-DOC-*` rule ids.
