# Lens: tests

Read `reviewer-contract.md` and the test sections of `rules/repository-conventions.md`.

Your angle is whether the change is actually proven by the tests that accompany it. You are not
looking for product defects; you are looking for gaps between what the code promises and what the
tests demonstrate.

## Activate when

The diff adds or modifies source under `apps/`, `apis/`, `packages/`, or `scripts/`, or adds,
modifies, or deletes a test file. Always check that new behavior is covered, even when the diff
contains no test file at all.

## What needs no test

The requirement is that runtime behavior is proven, so a file has to be reachable at runtime to owe
a test. Do not report a missing test for:

- A script: a file under a `scripts/` directory is run by CI or by hand, not imported.
- A one-off fix: a change that repairs existing data, a migration run once, or a throwaway probe.
  Neither is part of the product's runtime.
- A file that exports nothing: nothing can import it, so there is no unit to call.
- A file whose only exports are types: a type has no runtime behavior to test.

Everything else that runs in production or in the test suite owes a test.

## What to check

1. **Every new behavior is covered.** A new handler, repository method, route, validation stage, or
   public function arrives with a test that exercises it. A new source file with no test beside it
   is a finding, and the repo treats this as blocking.
2. **The test proves the behavior.** A test that stubs a collaborator and then asserts the value it
   stubbed proves nothing. A test that asserts the response equals the fixture it just constructed
   proves nothing. The assertion must be able to fail when the implementation is wrong.
3. **Forwarding is asserted.** Where a handler delegates, the test asserts what the handler passed
   down, not only what came back.
4. **Failure paths are tested.** Each documented error outcome has a case: an unknown identifier, a
   stale revision, a malformed body, a blocking validation result. A suite that only covers the
   happy path is incomplete.
5. **No duplication.** A test that restates a case an existing suite already covers is a finding.
   Locate the existing suite before claiming coverage is missing.
6. **Fixtures over literals.** Documents under test come from the shared fixtures rather than being
   written inline in the test.
7. **Real dependencies.** Integration tests use a real database, skipping with a message when it is
   unreachable, rather than substituting an in-memory fake.
8. **Type-level assertions are not tests.** A file whose only content asserts that a type compiles
   proves nothing about behavior and does not belong in the suite.
9. **Deletions.** A change that removes a test must remove the behavior it covered or move the
   coverage elsewhere. A test deleted because it was inconvenient is a finding.
10. **Migration coverage.** A migration has a test that applies it and rolls it back.

## How to work

For each new source file in the diff, find the test that covers it and read that test. Report the
gap when the test is absent. When the test is present, read what it asserts and ask whether a
plausible bug would fail it; report when the answer is no.

Report `REPO-TEST-*` rule ids.
