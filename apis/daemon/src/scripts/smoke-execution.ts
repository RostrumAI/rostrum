/** @fileoverview Runs publications through preparation and the engine directly, with no HTTP or database. */

import assert from "node:assert/strict";
import type { RunSnapshot } from "@rostrum/workflow/execution";
import minimumJson from "@rostrum/workflow/fixtures/valid/minimum.json";
import sequentialJson from "@rostrum/workflow/fixtures/valid/sequential.json";
import calculationJson from "@rostrum/workflow/fixtures/valid/sequential-calculation.json";
import { WorkflowEngine } from "../services/runs/engine/workflow-engine";
import { PublicationPreparer } from "../services/runs/preparation/publication-preparer";
import { LocalTaskExecutor } from "../services/runs/tasks/local-task-executor";
import {
    createOperationRegistry,
    getRegistryCatalog,
} from "../services/runs/tasks/operations/operation-registry";

// The same pieces the daemon builds at startup, without a listener or a database.
const registry = createOperationRegistry();
const preparer = new PublicationPreparer(getRegistryCatalog(registry));
const engine = new WorkflowEngine({
    executor: new LocalTaskExecutor(registry),
    runTaskTimeoutMs: 30_000,
});

/** Prepares a fixture publication, admits one run, and resolves with its snapshot once it's done. */
async function run(
    document: { id: string },
    supplied: Record<string, unknown>,
): Promise<RunSnapshot> {
    const preparation = preparer.prepare(JSON.stringify(document), {
        workflowId: document.id,
        publicationNumber: 1,
        workflowFormatVersion: "v1",
        digest: "0".repeat(64),
    });
    assert.ok(preparation.ok, "the fixture must prepare");
    const accepted = preparer.validateInputs(preparation.workflow, supplied);
    assert.ok(accepted.ok, "the inputs must be accepted");

    // The run's registration is released when it's terminal; that's when to inspect it.
    const released = Promise.withResolvers<void>();
    const runId = engine.admit(preparation.workflow, accepted.inputs, {
        signal: new AbortController().signal,
        release: () => released.resolve(),
    });
    await released.promise;
    const snapshot = engine.inspectRun(runId);
    assert.ok(snapshot, "an admitted run must be inspectable");
    return snapshot;
}

/** Describes a finished run's outcome: its result, or its failure and location. */
function outcomeOf(snapshot: RunSnapshot): string {
    switch (snapshot.status) {
        case "completed":
            return JSON.stringify(snapshot.result);
        case "failed":
            return `${snapshot.failure.code} at ${snapshot.failure.path}`;
        default:
            return "still in progress";
    }
}

/** Prints one scenario's outcome. */
function report(name: string, snapshot: RunSnapshot): void {
    console.log(`${name}: ${snapshot.status} ${outcomeOf(snapshot)}`);
}

const full = await run(calculationJson, { amount: 90, surcharge: 10, people: 4 });
report("calculation 90/10/4", full);
assert.deepEqual(full.status === "completed" && full.result, { total: 100, perPerson: 25 });

const defaulted = await run(calculationJson, { amount: 90, people: 4 });
report("calculation 90/4, default surcharge", defaulted);
assert.deepEqual(defaulted.status === "completed" && defaulted.result, {
    total: 90,
    perPerson: 22.5,
});

const divisionByZero = await run(calculationJson, { amount: 90, people: 0 });
report("calculation with people 0", divisionByZero);
assert.ok(divisionByZero.status === "failed", "a division by zero fails the run");
assert.deepEqual(
    [divisionByZero.failure.code, divisionByZero.failure.path],
    ["division_by_zero", "/steps/1/inputs/divisor"],
);
assert.ok(!("result" in divisionByZero), "a failed run has no result");
const addition = divisionByZero.steps[0];
assert.deepEqual(addition?.status === "completed" && addition.output, { value: 90 });
console.log(
    `  addition still inspectable: ${JSON.stringify(addition?.status === "completed" && addition.output)}`,
);

const minimum = await run(minimumJson, {});
report("minimum.json", minimum);
assert.deepEqual(minimum.status === "completed" && minimum.result, {});

const greeting = await run(sequentialJson, { name: "Ada" });
report("sequential.json", greeting);
assert.deepEqual(greeting.status === "completed" && greeting.result, { greeting: "Hello, Ada!" });

console.log("smoke:execution ok: preparation, operations, bindings, traversal, and results agree");
