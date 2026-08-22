import type { TSchema } from "typebox";

/**
 * What one step type contributes to an interface version's rule set
 * (E1-S1). The type name selects the registration; the config schema is
 * the only per-type contract in v1.
 */
export interface StepTypeRegistration {
    /**
     * JSON Schema for the step's `config` object, enforced when a step of
     * this type carries a `config`. Absent means any config object passes;
     * the base shape stage still requires `config` to be an object.
     */
    configSchema?: TSchema;
}

/**
 * Registry of step types for one interface version.
 *
 * A step whose `type` is not registered is a blocking finding, never a
 * silent pass (E1-S1). The owning rule set seals the registry when it is
 * built, so a shipped rule set never gains or loses types.
 */
export class StepTypeRegistry {
    private readonly entries = new Map<string, StepTypeRegistration>();
    private sealed = false;

    /** Constructs a registry from initial registrations, in registration order. */
    constructor(registrations: Record<string, StepTypeRegistration> = {}) {
        for (const [type, registration] of Object.entries(registrations)) {
            this.register(type, registration);
        }
    }

    /** Registers one step type; throws when the registry is sealed. */
    register(type: string, registration: StepTypeRegistration = {}): void {
        if (this.sealed) {
            throw new Error(`Step-type registry is sealed; cannot register '${type}'`);
        }
        this.entries.set(type, registration);
    }

    /** Seals the registry against further registration. */
    seal(): void {
        this.sealed = true;
    }

    /** True when the type name is registered. */
    has(type: string): boolean {
        return this.entries.has(type);
    }

    /** Gets the registration for a type name, or undefined when the type is unknown. */
    registrationFor(type: string): StepTypeRegistration | undefined {
        return this.entries.get(type);
    }

    /** Lists registered type names in sorted order, for finding details. */
    types(): string[] {
        return [...this.entries.keys()].sort();
    }
}
