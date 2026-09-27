/** @fileoverview Checks a stored publication's document before it is prepared. */

import {
    escapePointerToken,
    type WorkflowDocument,
    WorkflowDocumentSchema,
} from "@rostrum/workflow";
import type { ExecutionFailure, RunPublication } from "@rostrum/workflow/execution";
import { Compile } from "typebox/compile";
import { createFailure } from "./execution-failures";

/**
 * Each check reads one concern of a parsed publication and returns every
 * located failure it finds, so a refusal can list them all: the document's
 * format and shape, its identity against the publication the run recorded,
 * the step links the engine traverses, and the step types and control flow
 * this release executes.
 */

/** The only workflow format this release executes. */
const SUPPORTED_FORMAT = "v1";

/** Checks parsed JSON against the workflow document's shape. */
const DOCUMENT_SHAPE = Compile(WorkflowDocumentSchema);

/**
 * Checks the parsed publication against the v1 document shape. An
 * unsupported format is reported on its own, since the rest of the shape
 * belongs to that format.
 */
export function checkShape(parsed: unknown): ExecutionFailure[] {
    const format =
        typeof parsed === "object" && parsed !== null && "workflowFormatVersion" in parsed
            ? parsed.workflowFormatVersion
            : undefined;
    if (format !== undefined && format !== SUPPORTED_FORMAT) {
        return [
            createFailure(
                "unsupported_format",
                "/workflowFormatVersion",
                `This release executes format '${SUPPORTED_FORMAT}' only`,
            ),
        ];
    }
    if (DOCUMENT_SHAPE.Check(parsed)) {
        return [];
    }
    return [...DOCUMENT_SHAPE.Errors(parsed)].flatMap((error) => {
        // A missing member fails `required` at its parent; locate each one at the member itself.
        const paths =
            error.keyword === "required"
                ? error.params.requiredProperties.map(
                      (name) => `${error.instancePath}/${escapePointerToken(name)}`,
                  )
                : [error.instancePath];
        return paths.map((path) =>
            createFailure(
                "invalid_document",
                path,
                `The document's shape is invalid: ${error.message}`,
            ),
        );
    });
}

/** Checks that the document is the publication the run recorded. */
export function checkIdentity(
    document: WorkflowDocument,
    publication: RunPublication,
): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    if (document.id !== publication.workflowId) {
        failures.push(
            createFailure(
                "publication_mismatch",
                "/id",
                "The document isn't the requested workflow",
            ),
        );
    }
    if (document.workflowFormatVersion !== publication.workflowFormatVersion) {
        failures.push(
            createFailure(
                "publication_mismatch",
                "/workflowFormatVersion",
                "The document's format doesn't match its publication",
            ),
        );
    }
    return failures;
}

/**
 * Checks the step identities and links the engine traverses: unique step
 * IDs, an existing entry step, and successors and dependencies that name
 * existing steps. Publication validation guarantees these, but the engine
 * can't run a document that breaks them.
 */
export function checkStructure(document: WorkflowDocument): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    const ids = new Set<string>();
    for (const [index, step] of document.steps.entries()) {
        if (ids.has(step.id)) {
            failures.push(
                createFailure(
                    "invalid_document",
                    `/steps/${index}/id`,
                    "The step ID is a duplicate",
                ),
            );
        }
        ids.add(step.id);
    }
    if (!ids.has(document.firstNode)) {
        failures.push(
            createFailure("invalid_document", "/firstNode", "The entry step doesn't exist"),
        );
    }
    for (const [index, step] of document.steps.entries()) {
        for (const field of ["successors", "dependencies"] as const) {
            for (const [position, target] of (step[field] ?? []).entries()) {
                if (!ids.has(target)) {
                    failures.push(
                        createFailure(
                            "invalid_document",
                            `/steps/${index}/${field}/${position}`,
                            "The linked step doesn't exist",
                            step.id,
                        ),
                    );
                }
            }
        }
    }
    return failures;
}

/**
 * Checks the step types and control flow this release executes: task and
 * result steps, a result step without configuration, no conditionals or
 * loops, at most one distinct successor, and no step that depends on
 * itself.
 */
export function checkSupportedSteps(document: WorkflowDocument): ExecutionFailure[] {
    const failures: ExecutionFailure[] = [];
    if ((document.conditionals ?? []).length > 0) {
        failures.push(
            createFailure(
                "unsupported_control_flow",
                "/conditionals",
                "Conditionals aren't executed by this release",
            ),
        );
    }
    for (const [index, step] of document.steps.entries()) {
        const path = `/steps/${index}`;
        if (step.type !== "task" && step.type !== "result") {
            failures.push(
                createFailure(
                    "unsupported_step_type",
                    `${path}/type`,
                    // The type is author-supplied text, so the path locates it instead of the message.
                    "The step type isn't supported",
                    step.id,
                ),
            );
        }
        if (step.type === "result" && step.config !== undefined) {
            failures.push(
                createFailure(
                    "invalid_config",
                    `${path}/config`,
                    "A result step has no configuration",
                    step.id,
                ),
            );
        }
        if (step.conditional !== undefined) {
            failures.push(
                createFailure(
                    "unsupported_control_flow",
                    `${path}/conditional`,
                    "Conditional routing isn't executed yet",
                    step.id,
                ),
            );
        }
        if (step.loop !== undefined) {
            failures.push(
                createFailure(
                    "unsupported_control_flow",
                    `${path}/loop`,
                    "Loops aren't executed yet",
                    step.id,
                ),
            );
        }
        if (new Set(step.successors ?? []).size > 1) {
            failures.push(
                createFailure(
                    "unsupported_control_flow",
                    `${path}/successors`,
                    "Parallel successors aren't executed yet",
                    step.id,
                ),
            );
        }
        for (const [position, dependency] of (step.dependencies ?? []).entries()) {
            if (dependency === step.id) {
                failures.push(
                    createFailure(
                        "self_dependency",
                        `${path}/dependencies/${position}`,
                        "The step lists itself as a dependency",
                        step.id,
                    ),
                );
            }
        }
    }
    return failures;
}
