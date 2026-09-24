import type {
    DeclaredSchemaCompiler,
    JsonSchema,
} from "../declared-schemas/declared-schema-compiler";
import { checkSchemaContainment } from "../declared-schemas/schema-containment";
import type { WorkflowConditional } from "../schema";
import type { SchemaProducer, StaticCompatibilityIssue } from "./static-compatibility-check";

/**
 * The condition-operand rules of the static compatibility check.
 *
 * A condition leaf compares a referenced step output with an operator and
 * an optional comparison value. Conditionals don't execute yet, but
 * publication validates them, so each leaf must provably suit its
 * operator: an ordering operator needs numbers, `contains` needs a string
 * or an array, `in` and `notin` need an array value, and an equality or
 * membership test must be able to succeed, or its outcome is fixed.
 */

/** One leaf predicate and where it sits in the document. */
interface ConditionLeaf {
    /** The referenced output, `step.<stepId>.<outputName>`. */
    ref: string;
    /** The operator name. */
    op: unknown;
    /** True when the leaf carries a comparison value. */
    hasValue: boolean;
    /** The comparison value, when present. */
    value: unknown;
    /** JSON Pointer to the leaf. */
    path: string;
    /** The conditional the leaf belongs to. */
    conditionalId: string;
}

/** The consumer that requires a number. */
const NUMBER_SCHEMA: JsonSchema = { type: "number" };

/** The consumer that requires a string. */
const STRING_SCHEMA: JsonSchema = { type: "string" };

/** The consumer that requires an array. */
const ARRAY_SCHEMA: JsonSchema = { type: "array" };

/**
 * Checks every condition leaf's operands. `resolveProducer` describes a
 * referenced step output, or returns undefined when it doesn't resolve to
 * a catalog operation's output, which other rules report.
 */
export function checkConditionOperands(
    conditionals: readonly WorkflowConditional[],
    compiler: DeclaredSchemaCompiler,
    resolveProducer: (ref: string) => SchemaProducer | undefined,
): StaticCompatibilityIssue[] {
    const issues: StaticCompatibilityIssue[] = [];
    for (const [conditionalIndex, conditional] of conditionals.entries()) {
        for (const [branchIndex, branch] of conditional.branches.entries()) {
            const leaves: ConditionLeaf[] = [];
            collectLeaves(
                branch.condition,
                `/conditionals/${conditionalIndex}/branches/${branchIndex}/condition`,
                conditional.id,
                leaves,
            );
            for (const leaf of leaves) {
                const producer = resolveProducer(leaf.ref);
                const issue = producer ? checkLeaf(leaf, producer, compiler) : undefined;
                if (issue) {
                    issues.push(issue);
                }
            }
        }
    }
    return issues;
}

/** Walks a condition tree and collects its leaf predicates with their pointers. */
function collectLeaves(
    condition: unknown,
    path: string,
    conditionalId: string,
    leaves: ConditionLeaf[],
): void {
    if (typeof condition !== "object" || condition === null) {
        return;
    }
    // The document schema proved this is a condition object; the record
    // view only unlocks member access for the walk.
    const record = condition as Record<string, unknown>;
    if (typeof record.ref === "string") {
        leaves.push({
            ref: record.ref,
            op: record.op,
            hasValue: Object.hasOwn(record, "value"),
            value: record.value,
            path,
            conditionalId,
        });
        return;
    }
    for (const key of ["all", "any"] as const) {
        const children = record[key];
        if (Array.isArray(children)) {
            children.forEach((child, index) => {
                collectLeaves(child, `${path}/${key}/${index}`, conditionalId, leaves);
            });
        }
    }
}

/** Checks one leaf against its operator's rule; returns the issue, or undefined when it fits. */
function checkLeaf(
    leaf: ConditionLeaf,
    producer: SchemaProducer,
    compiler: DeclaredSchemaCompiler,
): StaticCompatibilityIssue | undefined {
    const op = typeof leaf.op === "string" ? leaf.op : "";
    const contained = (consumer: JsonSchema) =>
        checkSchemaContainment(producer.schema, consumer, { producerRoot: producer.root }).kind ===
        "contained";
    const allows = (value: unknown) => {
        const compiled = compiler.compile(producer.schema);
        return compiled.ok && compiled.check(value).length === 0;
    };

    let fits: boolean;
    let rule: string;
    switch (op) {
        case "gt":
        case "gte":
        case "lt":
        case "lte":
            fits = contained(NUMBER_SCHEMA) && typeof leaf.value === "number";
            rule = `'${op}' needs a number output and a number value`;
            break;
        case "contains":
            fits =
                (contained(STRING_SCHEMA) && typeof leaf.value === "string") ||
                contained(ARRAY_SCHEMA);
            rule = "'contains' needs a string output with a string value, or an array output";
            break;
        case "in":
        case "notin":
            fits = Array.isArray(leaf.value) && leaf.value.some(allows);
            rule = `'${op}' needs an array value with at least one element the output can equal`;
            break;
        case "eq":
        case "neq":
            fits = leaf.hasValue && allows(leaf.value);
            rule = `'${op}' needs a value the output can equal`;
            break;
        default:
            // `truthy` and `falsy` accept anything; unknown operators are the conditional stage's concern.
            return undefined;
    }
    if (fits) {
        return undefined;
    }
    return {
        kind: "operand-mismatch",
        path: leaf.path,
        message: `Condition on '${leaf.ref}' can't be meaningfully evaluated: ${rule}`,
        details: { conditionalId: leaf.conditionalId, ref: leaf.ref, operator: op },
    };
}
