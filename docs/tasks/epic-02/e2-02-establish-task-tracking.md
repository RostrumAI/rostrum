# E2-02: Establish task tracking and remove task IDs from code

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | None |

## Task

This task decides where Rostrum tracks implementation work after completing the current Markdown task plan. It also separates temporary planning references from durable code and product documentation.

The repository uses Markdown files to track task status, assignment, dependencies, scope, and acceptance criteria. Source comments and test names also cite task IDs such as `E1-02`, `E1-S2`, and `E1-07`. These references become unclear after tasks move, split, or close. A reader must search planning documents to understand code that should explain its own current behavior.

## Alternatives to assess

| Alternative | Source of truth | Benefit | Cost or risk |
| --- | --- | --- | --- |
| GitHub Issues and Projects | Issues hold executable work; a Project holds status, owner, priority, and dependencies. Repository Epic documents, decisions, and specifications hold durable product and technical contracts. | Uses purpose-built assignment, filtering, history, and pull-request links without keeping status tables synchronized by hand. | Requires GitHub access and a clear rule for which details remain in the repository. |
| Repository Markdown | Task files remain authoritative for status, ownership, dependencies, and acceptance criteria. | Works offline and keeps planning beside the code. | Status and assignments are manual, cross-file dependencies are hard to query, and stale task links remain likely. |
| Repository task manifest | A machine-readable manifest holds task metadata while Markdown files hold descriptions. | Allows automated dependency and status checks without requiring an external tracker. | Introduces a custom tracking system that Rostrum must maintain. |
| Mirrored hybrid | Markdown task files and GitHub Issues both hold status and task details. | Gives contributors both repository context and tracker views. | Creates two sources of truth and requires synchronization rules or automation. |

The starting recommendation is GitHub Issues and Projects as the source of truth for active implementation work. Repository Epic documents define outcomes and sequencing, while decisions and specifications preserve approved contracts. A repository task brief remains useful only when its technical content must outlive the issue. The task must confirm this choice against offline access, automation, and contributor workflow before migration.

## Decisions required

The selected approach must answer:

- Where do status, owner, priority, blockers, and completion live?
- Which planning information remains in an Epic document?
- When does work need a repository task brief in addition to a tracker item?
- How do time-boxed research tasks (spikes) link research, decisions, and proof results?
- How do pull requests and commits identify the work they complete?
- How are task dependencies represented and checked?
- What happens to the existing `docs/tasks` directory tree?
- Which identifiers are stable enough for code comments and public documentation?

## Code cleanup

After the tracking decision, remove planning-task references from source code, tests, package documentation, and scripts.

For each reference:

1. Delete the reference when the surrounding code already explains the behavior.
2. Replace the reference with the invariant or reason when the task ID stands in for a missing explanation.
3. Link a stable specification or approved decision when the code implements a durable external contract.
4. Keep issue or task IDs in pull requests and commit history, not in code identifiers, test names, or comments.

The cleanup covers `apps/`, `packages/`, and `scripts/`. It includes references in comments, doc comments, test suite names, test descriptions, and package README files.

## End state

Contributors have one documented place to track active work. Code explains current behavior without requiring readers to find the task that originally introduced it.

## Why

Task IDs describe how work was organized at one point in time. They are not stable names for runtime behavior. Keeping task IDs in code couples long-lived implementation details to a planning system that is difficult to query and maintain.

## Blocks

- [E2-03: Define the executable workflow contract](e2-03-define-executable-workflow-contract.md)
- [E2-05: Build the local daemon](e2-05-build-local-daemon.md)

## Acceptance criteria

- One reviewed decision names the source of truth for active tasks and defines the role of Epics, task briefs, spike research, decisions, results, issues, pull requests, and commits.
- The decision defines status, ownership, dependency, prioritization, and completion workflows.
- The chosen system has a documented migration plan for the current Markdown tasks and preserves any durable requirements before removing task files.
- Repository guidance explains how contributors create, start, block, review, and close future work.
- Code comments and test names state current behavior or rationale without referring to planning-task IDs.
- Stable specifications or approved decisions replace task references when code needs a durable contract citation.
- No Epic or task ID remains in `apps/`, `packages/`, or `scripts/` source comments, test names, or package documentation, except fixture data that intentionally tests an identifier format.
- One automated repository check prevents new planning-task references from being added to code if the selected tracking policy requires that enforcement.
- Documentation links and tracker links resolve after the migration; no task exists in two places as an independent source of truth.
