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

Apply the key standards below while writing code, not only during review. The automated review's [repository conventions](.github/skills/code-review/rules/repository-conventions.md) and [TypeScript rules](.github/skills/code-review/rules/google-typescript.md) contain the detailed requirements, scopes, and exceptions. Repository-specific requirements and tooling configuration take precedence over the general TypeScript guide.

### Names and module boundaries

- Name functions for their action and subject, using `get` for retrieval. A call such as `generateOpenApi()` or `createWorkflow()` should explain its effect without opening the definition.
- Use descriptive names and the current domain terminology; avoid ambiguous abbreviations. Treat acronyms as words (`parseJson`, not `parseJSON`). Use `UpperCamelCase` for types and classes and `lowerCamelCase` for functions, variables, and properties, except module-level and static readonly constants, which use `CONSTANT_CASE`.
- Keep schemas and helpers at the smallest scope that consumes them. Export only what other modules use, with named exports rather than defaults.
- Use relative imports within a package and workspace package names across packages. Packages must not import from applications or introduce package dependency cycles.
- Construct service dependencies at process startup and inject them into handlers. Do not introduce mutable module-level service instances, lazy process-wide services, or setters used only to replace collaborators in tests.
- Reuse existing helpers and maintained libraries before adding infrastructure. Avoid passthrough wrappers, re-export-only modules without a purpose, and shared abstractions without concrete consumers.
- Remove modules, compatibility shims, aliases, and temporary artifacts made obsolete by the change. Do not retain speculative features or unfinished-work markers in source.

### Function flow

Write function bodies so a reader can follow the steps without reconstructing them.

- Group statements by idea, and separate the groups with one blank line. Each group completes one job: reading inputs, deriving a value, registering middleware or routes, building shared state, handling failure.
- Start each group with one short comment saying what the step accomplishes for the caller, in plain language a junior engineer with product knowledge can follow. State the purpose of the step rather than narrating the statements beneath it.
- A function that carries a single idea takes no step comments and no internal grouping.
- Use explicit, multiline braced bodies for conditionals and loops; no single-line `if` or unbraced shorthand.
- Prefer a `switch` for three or more branches testing the same value. Avoid nested ternaries that make the execution path harder to follow.
- Build complex result objects in clear steps when nested spreads obscure the resulting fields or which value wins. Simple spreads do not need to be expanded.

### Types and validation

- Use concrete types, generics tied to real inputs, or `unknown` with a guard, schema, or decoder. Do not use `any`, type-error suppressions, or assertions to hide a mismatch. If a type or non-null assertion is necessary, explain the guarantee that makes it safe.
- Give operations strict return types that distinguish their outcomes, including documented failures. Do not replace distinct outcomes with a bag of optional fields.
- Validate untrusted input at the schema boundary and share validation that must agree across entry points. Do not re-check shapes the boundary already proved; a well-formed identifier still needs an existence check.
- Prefer interfaces for object shapes and simple type constructs over clever derivations. Annotate object literals at their declaration rather than casting them; let obvious local values use inference.

### Comments and TSDoc

- Put concise TSDoc on exported declarations, classes, functions, and private helpers. State purpose and the caller-facing contract; execution detail belongs beside the statements it explains.
- Give every named property and method in an interface or object type literal its own immediately preceding TSDoc, including inline object types. Explain what the member contains, controls, or returns. Ordinary object values and generated `Record` or mapped-type members do not need per-key TSDoc.
- Explain opaque constants, protocol values, and non-obvious rules with short purpose comments. Do not merely restate a name, type, signature, or statement.
- Use `//` for implementation comments. Describe the concept rather than citing repository file paths as the explanation.

### Errors and side effects

- Await or return promises. Mark deliberate fire-and-forget work explicitly and handle its rejection; do not pass async functions to callbacks that require synchronous completion.
- Keep `try` blocks focused on the operation expected to throw. Throw `Error` objects, preserve the cause when wrapping failures, and explain any intentionally ignored failure rather than silently treating it as success.
- Release acquired resources on failure as well as success. Keep request-specific mutable state out of shared objects.
- Use the configured logger in application code; direct console output is reserved for scripts, tests, and the logging layer. Do not expose credentials, tokens, or connection strings in logs or responses.

## Tests

Every test documents what it proves.

- Put a comment above each test stating what it is meant to test. A unit test states the technical behavior; an integration, end-to-end, or smoke test states the product requirement.
- Inside the test, comment what each block sets up and why, and what the assertions check.
- Keep each comment to one short line, and never restate the code beside it.
- Cover the edge cases, not only the happy path: empty collections, malformed input, conflicting state, values at a boundary, repeated invocations, and every documented failure outcome.
- Assert observable behavior that would fail for a plausible implementation bug, not a mock's canned response, a compile-time type, or a schema's literal shape.
- Find existing coverage before adding cases, and remove suites made redundant by the change. Keep tests beside the code they exercise and reuse shared document fixtures rather than embedding workflow documents.

The [repository review rules](.github/skills/code-review/rules/repository-conventions.md#9-tests-coverage-and-quality) state the detailed test requirements and exceptions.
