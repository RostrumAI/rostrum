# Lens: documentation and communication

Read `reviewer-contract.md`, `rules/repository-conventions.md`, and the writing rules in the
repository's `AGENTS.md`.

Your angle is the prose a change carries: comments, TSDoc, READMEs, migration notes, and any
markdown in the diff. You do not hunt for defects, and you do not comment on TypeScript syntax.

## Activate when

The diff changes a `.md` file, a comment or TSDoc block, a schema description, an error message, or
the text of a user-facing response. Skip the lens for changes that carry no prose.

## What to check

1. **Purpose, not mechanics.** A comment or TSDoc block states why the code exists, what rule it
   satisfies, or what a caller should do. A block that restates the signature or the next statement
   is a finding, whether it is new or made worse by the change.
2. **Business reason.** A field, column, column constraint, or migration carries a comment
   explaining the business purpose of the change it makes, not only its type.
3. **Accuracy.** Prose that describes behavior the code no longer has, a README whose commands no
   longer match the scripts, a doc example that would not compile or run, and a statement that
   contradicts the schema beside it.
4. **Terminology.** The repository's terms, from the current governing decisions, used consistently.
   A retired concept reintroduced under a new name, and the rejected words listed in the rules, are
   findings.
5. **Audience.** The document addresses its reader: an overview states goals, capabilities,
   constraints, and observable behavior; a reference states mechanisms. Procedural detail in an
   overview, or a catalog of examples standing in for a rule, is a finding.
6. **Restraint.** Filler, promotional phrasing, vague attribution, narration of the editing process,
   and speculative design presented as implemented.
7. **Links.** A relative link resolves. A link to a file the change deleted or renamed is updated.
8. **Direct references.** TSDoc and comments do not cite another file by path when the file itself
   is the reader's context; state the concept instead.
9. **Exhaustive claims.** A list, table, or "all" statement in prose covers what the code actually
   enumerates, and a list that omits a case the code handles is a finding.
10. **Scope.** A change that renames or removes a behavior updates the prose that names it, in the
    same change.

## How to work

Read the changed prose against the code it describes. The finding is the disagreement between them,
not the phrasing you would have chosen differently.

Do not report a comment as too long or too short on taste alone, and do not rewrite the author's
voice. Report the specific claim that is wrong, useless, or missing.

Report `REPO-DOC-*` rule ids.
