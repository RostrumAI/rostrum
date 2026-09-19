/** @fileoverview Rejects controller imports that can reach persistence directly. */

import { dirname, relative, resolve } from "node:path";

/** Import specifiers that open a database connection or run a query. */
const DATABASE_SPECIFIERS = [
    "@rostrum/database",
    "bun",
    "bun:sqlite",
    "kysely",
    "kysely-postgres-js",
    "pg",
    "postgres",
];

/** Service-tier modules that carry domain vocabulary only: schemas and error classes. */
const SHARED_SERVICE_MODULE_PATTERN = /(?:^|[-.])(?:errors|schemas)\.ts$/;

/** One controller, the local modules reached from it, and the rule that was broken. */
interface Violation {
    /** Local modules traversed to reach the forbidden import, controller first. */
    readonly chain: readonly string[];
    /** What the last module in the chain imported, and why a controller may not. */
    readonly broken: string;
}

/**
 * The parser the walk reads with: `.ts`, never `.tsx`. The TSX loader reads every
 * file as JSX, so a generic arrow function — `const first = <T>(items: readonly T[]): T => items[0];`
 * — is a syntax error there, and the check would abort on valid TypeScript instead
 * of reporting an import.
 */
const SCANNER = new Bun.Transpiler({ loader: "ts" });

/** Lists the imports of one module, which the walk then resolves locally. */
export function scanImports(source: string) {
    return SCANNER.scan(source).imports;
}

/** Resolves one local import to a repository-relative module path. */
function resolveLocal(fromPath: string, specifier: string, root: string): string | undefined {
    if (!specifier.startsWith(".")) {
        return undefined;
    }
    try {
        const resolved = Bun.resolveSync(specifier, dirname(resolve(root, fromPath)));
        const path = relative(root, resolved);
        return path.startsWith("..") ? undefined : path;
    } catch {
        // An unresolved specifier is a type error the compiler reports.
        return undefined;
    }
}

/**
 * Reports controller imports that reach persistence.
 *
 * The controller tier orchestrates: it reads an operation's outcome from an
 * injected service and writes the transport response. A controller that could
 * open a connection or run a query would bypass the service that owns the
 * business rules, so the check walks every value import a controller can reach
 * locally — helpers included — and reports the first forbidden import on each
 * path. A service module is reached through the request context, never by
 * importing it, except the modules that carry domain vocabulary alone. Type-only
 * imports are ignored because they cannot call anything.
 */
async function checkControllerBoundaries(): Promise<void> {
    const root = resolve(import.meta.dir, "..");
    const controllers = new Bun.Glob("apis/*/src/controllers/**/*.ts");
    const entryPoints: string[] = [];
    for await (const path of controllers.scan({ cwd: root, onlyFiles: true })) {
        if (!path.endsWith(".test.ts") && !path.endsWith(".fixture.ts")) {
            entryPoints.push(path);
        }
    }
    if (entryPoints.length === 0) {
        throw new Error("Found no controllers to check; the boundary covers no code");
    }

    // Walk each controller's local import graph, recording the path that broke a rule.
    const violations: Violation[] = [];
    for (const controller of entryPoints) {
        const visited = new Map<string, readonly string[]>([[controller, [controller]]]);
        const pending = [controller];
        while (pending.length > 0) {
            const path = pending.pop() ?? controller;
            const chain = visited.get(path) ?? [path];
            const source = await Bun.file(resolve(root, path)).text();
            for (const imported of scanImports(source)) {
                const database = DATABASE_SPECIFIERS.find(
                    (name) => imported.path === name || imported.path.startsWith(`${name}/`),
                );
                if (database !== undefined) {
                    violations.push({
                        chain,
                        broken: `imports ${database}, which opens database connections`,
                    });
                    continue;
                }

                // Following every local import keeps a helper from smuggling in the database.
                const reached = resolveLocal(path, imported.path, root);
                if (reached === undefined || visited.has(reached)) {
                    continue;
                }
                const next = [...chain, reached];
                visited.set(reached, next);
                const inDatabasePackage = reached.startsWith("packages/database/");
                const inServiceTier = /^apis\/[^/]+\/src\/services\//.test(reached);
                if (inDatabasePackage) {
                    violations.push({
                        chain: next,
                        broken: `imports ${reached}, which opens database connections`,
                    });
                    continue;
                }
                if (inServiceTier) {
                    const fileName = reached.slice(reached.lastIndexOf("/") + 1);
                    if (!SHARED_SERVICE_MODULE_PATTERN.test(fileName)) {
                        violations.push({
                            chain: next,
                            broken: `imports ${reached}, so the controller would build business logic instead of reading it from its context`,
                        });
                        continue;
                    }
                }
                if (/\.(?:test|fixture)\.ts$/.test(reached) || reached.includes("node_modules/")) {
                    continue;
                }
                pending.push(reached);
            }
        }
    }

    if (violations.length > 0) {
        for (const violation of violations) {
            console.error(`${violation.chain.join(" -> ")} ${violation.broken}`);
        }
        const summary =
            violations.length === 1
                ? "1 controller import breaks"
                : `${violations.length} controller imports break`;
        throw new Error(`${summary} the controller boundary`);
    }
    console.log(`Controller boundaries: ${entryPoints.length} controllers reach no database`);
}

// Only a direct run performs the check; importing this module for its parser does not.
if (import.meta.main) {
    await checkControllerBoundaries();
}
