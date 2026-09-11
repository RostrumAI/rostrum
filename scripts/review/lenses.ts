/**
 * The reviewer panel: which lenses exist and when each one runs.
 *
 * @remarks
 * Running every lens against every pull request wastes calls on angles the diff
 * cannot violate, and noise is the main failure mode of automated review. Each
 * lens therefore declares an activation predicate over the changed files, and
 * the orchestrator runs only the lenses a change justifies.
 */

import type { FileDiff, Lens } from "./types.ts";

/** Path segments that mark a change as documentation. */
const DOCUMENTATION_SUFFIXES = [".md", ".mdx"];

/**
 * Path segments that mark a change as touching an external trust boundary.
 *
 * The list is deliberately about *where input enters or leaves*, not about which
 * subsystem the code belongs to. A request handler is covered by the feature-slice
 * rule below rather than by a fragment here, because a handler's file name says
 * nothing about what it does.
 */
const SECURITY_PATH_FRAGMENTS = [
    "auth",
    "token",
    "secret",
    "credential",
    "session",
    "middleware",
    "http",
    "fetch",
    "request",
    "route",
    "loader",
    "migration",
    "config",
    "logger",
    "database",
    "client",
    "server",
];

/** Path fragments that mark a change as configuration rather than behavior. */
const CONFIGURATION_FILES = [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "biome.json",
    "docker-compose.yml",
    "ci.yml",
    "openapi.json",
];

/** Every source file a lens may be asked to consider. */
function isSource(file: FileDiff): boolean {
    return file.path.endsWith(".ts") || file.path.endsWith(".tsx");
}

/**
 * Decides whether a path carries prose the documentation lens should read.
 *
 * @param file - Parsed file diff.
 * @returns True when the file is markdown.
 */
function isDocumentation(file: FileDiff): boolean {
    return DOCUMENTATION_SUFFIXES.some((suffix) => file.path.endsWith(suffix));
}

/** Returns the path segments of a file, lowercased, for fragment matching. */
function segments(file: FileDiff): string[] {
    return file.path.toLowerCase().split(/[/.]/);
}

/** The reviewer panel, in report order. */
export const LENSES: Lens[] = [
    {
        id: "correctness",
        label: "Correctness",
        promptPath: "lenses/01-correctness.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: () => true,
    },
    {
        id: "contracts",
        label: "Contracts and structure",
        promptPath: "lenses/02-contracts.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: (files) =>
            files.some(
                (file) =>
                    isSource(file) && !CONFIGURATION_FILES.some((name) => file.path.endsWith(name)),
            ),
    },
    {
        id: "tests",
        label: "Tests",
        promptPath: "lenses/03-tests.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: (files) =>
            files.some(
                (file) =>
                    isSource(file) ||
                    file.path.includes(".test.") ||
                    file.path.includes("__tests__"),
            ),
    },
    {
        id: "typescript",
        label: "TypeScript style",
        promptPath: "lenses/04-typescript-style.md",
        rulePaths: ["rules/google-typescript.md", "rules/repository-conventions.md"],
        applies: (files) => files.some(isSource),
    },
    {
        id: "security",
        label: "Security",
        promptPath: "lenses/05-security.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: (files) =>
            files.some((file) => {
                if (!isSource(file) && !file.path.endsWith("package.json")) {
                    return false;
                }
                // A feature slice is a request handler: it takes caller input by
                // definition, whatever its file is named.
                if (/(?:^|\/)(?:apps|apis)\/[^/]+\/src\/features\//.test(file.path)) {
                    return true;
                }
                const parts = segments(file);
                return SECURITY_PATH_FRAGMENTS.some((fragment) => parts.includes(fragment));
            }),
    },
    {
        id: "documentation",
        label: "Documentation",
        promptPath: "lenses/06-documentation.md",
        rulePaths: ["rules/repository-conventions.md"],
        applies: (files) =>
            files.some(
                (file) =>
                    isDocumentation(file) || (isSource(file) && !file.path.includes(".test.")),
            ),
    },
];

/**
 * Selects the lenses to run for a change.
 *
 * @param files - Parsed changed files.
 * @param requested - Lens ids from the command line; empty or absent means every applicable lens.
 * @returns The lenses to run, in panel order.
 * @throws Error naming an unknown lens id.
 */
export function selectLenses(files: FileDiff[], requested: string[]): Lens[] {
    const known = new Map(LENSES.map((lens) => [lens.id, lens]));
    if (requested.length === 0) {
        return LENSES.filter((lens) => lens.applies(files));
    }
    return requested.map((id) => {
        const lens = known.get(id);
        if (lens === undefined) {
            throw new Error(`Unknown lens "${id}". Available: ${[...known.keys()].join(", ")}`);
        }
        return lens;
    });
}
