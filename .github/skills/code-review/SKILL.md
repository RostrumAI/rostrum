---
name: code-review
description: Review a Rostrum pull request with independent parallel reviewer agents, or run the automated review the way CI does. Use when asked to review a PR, review the current branch, or check a diff against Rostrum conventions. Covers the reviewer panel, the finding contract, confidence filtering, and how to rescan a PR without reopening resolved comments.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Rostrum code review

Review a pull request with several independent reviewers, keep only findings that survive adversarial
verification, and post the remainder as inline comments. The same corpus drives the automated review
that runs on every pull request, so a review performed by hand and a review performed by CI look
identical to the author.

## Corpus layout

| Path | Contents |
| --- | --- |
| `rules/repository-conventions.md` | Rostrum conventions mined from review history; ids look like `REPO-ARCH-01` |
| `rules/google-typescript.md` | TypeScript rules adapted from the Google style guide; ids look like `GTS-EXPORTS-01` |
| `lenses/*.md` | One file per reviewer. Each is a system prompt for a single independent reviewer |
| `reviewer-contract.md` | The finding contract, severity scale, confidence scale, and reporting rules |

Rules carry a severity and a classification. `mechanical` rules are also checked by
`bun run review --dry-run-rules`, which produces findings without a model; do not re-report a
`mechanical` violation the deterministic pass already found, unless you can show it missed the
changed line.

## Reviewing a pull request

1. Fetch the pull request metadata, changed-file list, and diff. Confirm it is worth reviewing: skip
   drafts, skip a head branch whose diff contains only lockfile or generated-artifact changes, and
   skip a pull request whose body or title carries `[skip review]`.
2. Read `reviewer-contract.md`, then every rule file. Read them in full before looking at the diff.
3. Choose the lenses that the diff justifies, using the activation table in each lens file. Running
   a lens whose subject the diff does not touch produces noise, not coverage.
4. Run the deterministic pass and keep its findings.
5. Run each chosen lens as its own reviewer. In this harness, dispatch one `task` subagent per lens
   in a single batch, giving each subagent the lens file as its instructions, the repository as its
   working directory, and read-only tools. A lens reviewer must not edit code.
6. Verify before reporting. For each finding, open the cited line and confirm the claim. Drop any
   finding you cannot confirm against the source, and drop any finding whose rule does not say what
   the reviewer claims it says. Reviewers hallucinate line numbers and imaginary bugs.
7. Merge the deterministic and model findings, deduplicate by rule and location, apply the
   confidence floor, and drop findings covered by the suppression rules below.
8. Post one review containing every surviving finding as an inline comment, plus a summary body.

## Posting

Use the automated poster rather than hand-rolled `gh` calls; it performs suppression, dedup, and
summary maintenance consistently:

```bash
bun run review --pr <number> --post
```

Without `--post` the same command prints the report to stdout and touches nothing. `--repo-root`
names the checkout the reviewers read, which in CI is the pull request head while the script and the
rule corpus come from the base branch.

## Rescanning

A rescan reviews the current head commit and answers only findings that are still open.

```bash
bun run review --pr <number> --post
```

Suppression rules, in order:

1. A bot comment whose thread GitHub reports as resolved suppresses a finding with the same rule and
   the same code evidence, even when the line has moved. Resolved threads are never reopened.
2. A bot comment whose thread is still open suppresses a duplicate for the same rule and path within
   five lines.
3. `resolved` and `outdated` threads are read from the review-thread state, not from comment text.
4. A human reply saying the finding is intentional suppresses it for that rule and path.

Never re-post a finding to restate it. If the fix landed, the finding disappears from the report
because the code no longer matches the rule.

## Manual invocation

```bash
bun run review --pr 20                    # report only
bun run review --pr 20 --post             # post inline comments
bun run review --pr 20 --lenses tests,documentation  # restrict the panel
bun run review --since origin/main        # review a local branch diff instead
bun run review --pr 20 --repo-root ../pr-head  # review a checkout other than this one
```

Set `DEEPSEEK_API_KEY` to review. Set `REVIEW_MODEL` to override the model, and
`REVIEW_CONFIDENCE_FLOOR` to override the default confidence floor of 80.
