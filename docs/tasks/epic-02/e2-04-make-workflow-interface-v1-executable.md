# E2-04: Make workflow interface v1 executable

| Tracking | Value |
| --- | --- |
| Status | Not started |
| Last updated | 2026-08-28 |
| Picked up | No |
| Owner | Unassigned |
| Blocked by | [E2-03](e2-03-define-executable-workflow-contract.md) |

## Task

This task updates the shared workflow specification, schema, validator, and examples so every accepted workflow interface v1 document has the execution meaning defined by E2-03. This is Epic 02 work. It does not reopen Epic 01 tasks.

The task:

- requires `next` on every conditional branch and default;
- rejects duplicate conditional priorities;
- requires every selected path to reach an explicit `result` step;
- validates one matching join for every parallel split;
- allows sequences and properly nested parallel work inside a parallel path;
- rejects crossing paths, early terminals, conditionals inside open parallel sections, and conditionals on matching join steps;
- adds the loop failure-policy field and ordered result-entry schema;
- extends step-type definitions with required-input, optional-input, configuration, and exact-output schemas;
- validates authored step bindings and output declarations against those definitions;
- updates examples, validation findings, fixtures, generated schema, and digest vectors.

## End state

The shared workflow library cannot publish a workflow that the Epic 02 daemon would consider structurally ambiguous or statically unsupported.

## Why

The current workflow interface permits definitions that conflict with the approved execution behavior. The execution runtime must not add a second validator or reinterpret an already accepted document.

## Blocks

- [E2-06: Build the step interface and reference steps](e2-06-build-step-interface-and-reference-steps.md)
- [E2-07: Execute sequential and conditional workflows](e2-07-execute-sequential-and-conditional-workflows.md)

## Acceptance criteria

- The public workflow interface v1 specification describes the complete E2-03 authoring contract.
- The machine-readable schema and TypeScript types match the specification.
- Validation rejects missing conditional destinations and duplicate priorities with stable findings.
- Validation accepts each structured parallel fixture and rejects unmatched, crossing, conditional-containing, and early-terminal parallel paths.
- Loop definitions validate the documented failure policy and result shape.
- Step definitions bind every required input, name only registered required or optional inputs, and declare exactly the registered outputs.
- Statically known producer and consumer types must be compatible.
- Every valid E2-03 workflow fixture publishes successfully, and every invalid fixture produces its complete expected finding list.
- Existing examples and digest vectors are updated through a clean cutover with no compatibility aliases for the superseded forms.
