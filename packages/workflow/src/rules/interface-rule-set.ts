import type { TSchema } from "typebox";
import type { ValidationStage } from "../validation/validation-stage";
import type { StepTypeRegistry } from "./step-type-registry";

/**
 * One frozen interface-version rule set (E1-S1, E1-S4).
 *
 * Every release ships each supported version's rule set forward unchanged:
 * the document schema, the step-type registry, the metadata members the
 * digest excludes, and the stages that version runs. Rule selection is an
 * exact match on the declared `interfaceVersion`; an unknown version is a
 * blocking finding, never a fallback to a newer or older rule set.
 */
export interface InterfaceRuleSet {
    /** Exact-match version token, for example `"v1"`. */
    readonly version: string;
    /** Document shape schema enforced by the shape stage. */
    readonly documentSchema: TSchema;
    /** Step types registered for this version. */
    readonly stepTypes: StepTypeRegistry;
    /** Top-level metadata members removed before canonicalization (E1-S4). */
    readonly metadataMembers: readonly string[];
    /** Validation stages for this version, in execution order. */
    readonly stages: readonly ValidationStage[];
}

/**
 * Selects interface rule sets by exact version match.
 *
 * The registry is the only version-selection point in the library. The
 * version stage reports an unknown token as `workflow.version.unknown`
 * with the supported versions in `details`; nothing falls back.
 */
export class RuleSetRegistry {
    private readonly ruleSets = new Map<string, InterfaceRuleSet>();

    /** Constructs a registry over initial rule sets. */
    constructor(ruleSets: readonly InterfaceRuleSet[] = []) {
        for (const ruleSet of ruleSets) {
            this.register(ruleSet);
        }
    }

    /** Adds a rule set under its version token and freezes the rule set object. */
    register(ruleSet: InterfaceRuleSet): void {
        this.ruleSets.set(ruleSet.version, Object.freeze(ruleSet));
    }

    /** Gets the rule set for an exact version token, or undefined when the version is unsupported. */
    select(version: string): InterfaceRuleSet | undefined {
        return this.ruleSets.get(version);
    }

    /** Lists supported version tokens in sorted order, for finding details. */
    versions(): string[] {
        return [...this.ruleSets.keys()].sort();
    }
}
