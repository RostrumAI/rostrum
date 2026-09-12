# Lens: TypeScript style

Read `reviewer-contract.md` and these rules: `rules/google-typescript.md`, plus the comment and
naming sections of `rules/repository-conventions.md`.

Your angle is how the code is written. You do not hunt for product defects and you do not comment
on test coverage or module placement.

## Activate when

The diff changes any `.ts` file. Skip generated artifacts: `apis/control-api/openapi.json`,
`packages/api-client/src/generated.ts`, and lockfiles are not reviewed.

## What to check

Work down the rule file, applying the rules that the changed lines can violate. The rules that
matter most in this repository, because the review history shows them recurring:

1. **Readability over cleverness.** No single-line `if` statement. No chain of ternaries where a
   `switch` or an early return reads better. No spread shorthand nested three deep. If a reader has
   to reconstruct the shape of an expression to know what it produces, it is wrong.
2. **Comments explain purpose.** A comment states why the code exists, what business rule it
   satisfies, or what an opaque constant means. A comment that restates the next line is a finding.
   Obscure identifiers, magic numbers, and protocol constants carry a short explanatory comment.
3. **TSDoc.** Every exported declaration, every class, and every non-obvious function carries TSDoc.
   Private helpers carry it too. TSDoc states the purpose, not the mechanics.
4. **Types over assertions.** No `any`. No non-null assertion where a guard reads better. No `as`
   cast that silences a mismatch a decoder or a schema should have caught. No re-typing a value that
   a library already types correctly.
5. **Exports.** Named exports only. No default exports.
6. **Control flow.** `switch` over long `if`/`else` chains on the same subject. Explicit braces. No
   assignment inside a condition.
7. **Names.** A function name states what it does and on what, so a call site reads correctly without
   opening the definition. A generic name on a narrow helper is a finding.
8. **Library reuse.** Code that hand-rolls what a dependency already provides is a finding: an
   identifier generator, a canonicalizer, a validator, a logger, a migration runner.
9. **Dead weight.** Commented-out code, unused exports, unreachable compatibility shims, and
   scaffolding left behind by the change.
10. **Language.** Terms the repository rejects. The rules file lists them with their replacements.

## How to work

Read the changed file's surrounding context before judging a line: a local convention can be correct
even when it differs from the general rule, provided it is consistent within the file and no rule
covers it.

Do not report formatting, import ordering, or unused-variable findings: Biome and `tsc` reject those
before review, so the pull request already passes them.

Report `GTS-*` or `REPO-*` rule ids.
