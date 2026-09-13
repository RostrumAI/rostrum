# Repository agent instructions

## Branch safety

Before changing implementation files, run `git branch --show-current`.

Implementation work must not be done on `main`. If the current branch is `main`, create or switch to a feature branch before editing. Implementation files include source, tests, migrations, executable schemas, and build or deployment configuration.

## Development documentation

The canonical Rostrum product strategy, roadmap, technical Epics, implementation plans, human-readable specifications, decisions, and research live in [`RostrumAI/rostrum-dev-docs`](https://github.com/RostrumAI/rostrum-dev-docs). Run `bun run docs:setup` when the ignored `dev-docs/` checkout is absent. Commit and push documentation changes from inside that independent checkout.

Before planning or implementation, read `dev-docs/README.md`, the methodology, roadmap, relevant technical Epics, active plans, specifications, and decisions.

Do not recreate development planning documents in this repository. Keep source comments, API documentation generated from code, executable schemas, migrations, tests, fixtures, licensing, security information, and essential setup instructions with the implementation.

## Writing style

Write for the document's audience and purpose.

- Lead with what the reader needs to understand or decide. Assume relevant background knowledge, but explain unfamiliar terms and avoid unexplained shorthand.
- Match the level of detail to the document. Overviews describe goals, capabilities, constraints, and observable behavior. Include technical detail when it explains those things; put mechanisms, data structures, and procedural instructions in the appropriate reference or implementation document.
- Be precise without being exhaustive. Preserve distinctions that affect meaning, but remove repeated explanations, speculative designs, and detail that belongs at a later stage.
- Use examples only when they clarify a requirement or resolve ambiguity. Do not turn an overview into a catalog of sample implementations or a test procedure.
- Name the subject and scope of each rule. State what a restriction applies to, what remains allowed, and how exceptions affect the outcome. Avoid ambiguous pronouns and broad claims that imply unintended limits.
- Use consistent terminology from the current governing decisions. Distinguish existing behavior, agreed direction, and open proposals. Do not reintroduce retired concepts under new names or describe planned work as implemented.
- State responsibilities and dependencies clearly. Link to the source of detailed rules rather than repeating them in several places.
- Describe success and failure through observable outcomes. Approval language is not a substitute for saying what must be true; detailed verification steps belong with the work that performs them.
- Prefer direct, neutral prose and the simplest accurate words. Remove filler, promotional language, vague authority, and narration of the editing process. A document should make sense without its revision history.

## Code style

Write function bodies so a reader can follow the steps without reconstructing them.

- Group statements by idea, and separate the groups with one blank line. Each group completes one job: reading inputs, deriving a value, registering middleware or routes, building shared state, handling failure.
- Start each group with one short comment saying what the step accomplishes for the caller, in plain language a junior engineer with product knowledge can follow. State the purpose of the step rather than narrating the statements beneath it.
- A function that carries a single idea takes no step comments and no internal grouping.
- State purpose and contract in the declaration's TSDoc. Execution detail belongs in the comments beside the statements it explains, not in the block above the function.

The review rules in `.github/skills/code-review/rules/repository-conventions.md` state the detailed comment and TSDoc requirements.
