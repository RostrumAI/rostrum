/** @fileoverview Module importers from the head checkout, for the coverage exemption. */

import { dirname, join, normalize } from "node:path";
import { scanSourceLines } from "./source-text.ts";

/**
 * The import graph of a checkout, in both directions.
 *
 * @remarks
 * The graph is read from the files at the head commit rather than from the
 * diff. The question it answers is about the whole repository — whether any file
 * that owes a test imports a module the change adds — and a hunk cannot show the
 * imports of files the change does not touch.
 */

/** Source roots that hold repository modules. */
const MODULE_ROOTS = ["apps", "apis", "packages", "scripts"];

/** Directory names that hold no reviewed module. */
const EXCLUDED_SEGMENTS = ["node_modules", "dist", "coverage", "tmp", "dev-docs"];

/** Workspace manifests, which map a package name to the modules it exports. */
const WORKSPACE_MANIFESTS = "{apps,apis,packages}/*/package.json";

/** Suffixes a relative specifier resolves to, in the order resolution tries them. */
const MODULE_SUFFIXES = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Shared empty importer set, for a module the graph does not mention. */
const NO_IMPORTERS: ReadonlySet<string> = new Set<string>();

/** Every module a checkout holds, in both directions of its imports. */
export interface ImportGraph {
    /** Modules each module imports, keyed by repository-relative path. */
    readonly imports: ReadonlyMap<string, ReadonlySet<string>>;
    /** Modules that import each module, keyed by repository-relative path. */
    readonly importers: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Reads one module's text from the checkout.
 *
 * @param workingDirectory - Root of the checkout at the head commit.
 * @param path - Repository-relative path of the module.
 * @returns The module's text, or null when it cannot be read.
 */
async function readModule(workingDirectory: string, path: string): Promise<string | null> {
    try {
        return await Bun.file(`${workingDirectory}/${path}`).text();
    } catch {
        return null;
    }
}

/**
 * Lists the modules one source root holds.
 *
 * A root that cannot be read contributes nothing rather than failing the review:
 * fewer modules mean fewer resolved imports, which can only leave a module
 * looking less imported than it is.
 *
 * @param workingDirectory - Root of the checkout at the head commit.
 * @param root - Source root to scan.
 * @returns Repository-relative paths of the modules found under the root.
 */
async function scanModuleRoot(workingDirectory: string, root: string): Promise<string[]> {
    const paths: string[] = [];
    try {
        const glob = new Bun.Glob(`${root}/**/*.{ts,tsx}`);
        for await (const path of glob.scan({ cwd: workingDirectory, onlyFiles: true })) {
            const segments = path.split("/");
            if (EXCLUDED_SEGMENTS.some((segment) => segments.includes(segment))) {
                continue;
            }
            paths.push(path);
        }
    } catch {
        return [];
    }
    return paths;
}

/**
 * Lists the modules a checkout holds.
 *
 * @param workingDirectory - Root of the checkout at the head commit.
 * @returns Repository-relative paths of the modules found.
 */
async function scanModulePaths(workingDirectory: string): Promise<string[]> {
    const paths: string[] = [];
    for (const root of MODULE_ROOTS) {
        paths.push(...(await scanModuleRoot(workingDirectory, root)));
    }
    return paths;
}

/**
 * Maps every workspace export to the module it resolves to.
 *
 * An import between packages names the workspace rather than a relative path, so
 * the manifest's `exports` map is the only place that says which module
 * `@rostrum/server/config` is.
 *
 * @param workingDirectory - Root of the checkout at the head commit.
 * @returns Specifier to repository-relative module path.
 */
async function readWorkspaceExports(workingDirectory: string): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    try {
        const glob = new Bun.Glob(WORKSPACE_MANIFESTS);
        for await (const manifestPath of glob.scan({ cwd: workingDirectory, onlyFiles: true })) {
            const manifest = (await Bun.file(`${workingDirectory}/${manifestPath}`).json()) as {
                name?: unknown;
                exports?: unknown;
            };
            if (typeof manifest.name !== "string" || typeof manifest.exports !== "object") {
                continue;
            }
            if (manifest.exports === null) {
                continue;
            }
            const directory = dirname(manifestPath);
            for (const [key, value] of Object.entries(manifest.exports)) {
                // A patterned export names many files, none of them one module.
                if (typeof value !== "string" || key.includes("*")) {
                    continue;
                }
                const subpath = key === "." ? "" : key.replace(/^\./, "");
                resolved.set(`${manifest.name}${subpath}`, normalize(join(directory, value)));
            }
        }
    } catch {
        return new Map<string, string>();
    }
    return resolved;
}

/**
 * Reads the module specifiers of one file.
 *
 * The scan is comment- and string-aware, so a specifier that appears in prose,
 * in a doc example, or inside a template literal that a test builds a diff from
 * is not an import. The keyword must be followed by the quoted specifier for the
 * same reason: `const from = "./x"` is not an import.
 *
 * @param source - Text of a module.
 * @returns Specifiers the file imports from, in source order.
 */
function moduleSpecifiers(source: string): string[] {
    const lines = source.split("\n");
    const regions = scanSourceLines(lines);
    const specifiers: string[] = [];
    for (const [index, line] of lines.entries()) {
        // The code region keeps the line's indices and blanks everything the
        // keyword has to be outside of: comments, strings, and template literals.
        const code = regions[index]?.code ?? "";
        for (const keyword of code.matchAll(/\b(?:from|import|require)\b/g)) {
            const at = keyword.index ?? 0;
            const specifier = /^(?:from|import|require)\s*\(?\s*["']([^"']+)["']/.exec(
                line.slice(at),
            )?.[1];
            if (specifier !== undefined) {
                specifiers.push(specifier);
            }
        }
    }
    return specifiers;
}

/**
 * Resolves one specifier to a module of the checkout.
 *
 * @param fromPath - Module holding the specifier, repository-relative.
 * @param specifier - Text between the quotes of the import.
 * @param modules - Every module the checkout holds.
 * @param workspaceExports - Workspace specifiers mapped to module paths.
 * @returns The imported module's path, or undefined when it is not a repository module.
 */
function resolveSpecifier(
    fromPath: string,
    specifier: string,
    modules: ReadonlySet<string>,
    workspaceExports: ReadonlyMap<string, string>,
): string | undefined {
    if (specifier.startsWith(".")) {
        // `allowImportingTsExtensions` lets an import carry the suffix it targets,
        // so the bare path is tried before the suffixes are appended.
        const base = normalize(join(dirname(fromPath), specifier));
        for (const candidate of [base, ...MODULE_SUFFIXES.map((suffix) => `${base}${suffix}`)]) {
            if (modules.has(candidate)) {
                return candidate;
            }
        }
        return undefined;
    }
    const exported = workspaceExports.get(specifier);
    return exported !== undefined && modules.has(exported) ? exported : undefined;
}

/**
 * Builds the import graph of a checkout.
 *
 * @param workingDirectory - Root of the checkout at the head commit.
 * @returns Both directions of every import that resolves to a repository module.
 */
export async function buildImportGraph(workingDirectory: string): Promise<ImportGraph> {
    const paths = await scanModulePaths(workingDirectory);
    const modules = new Set(paths);
    const workspaceExports = await readWorkspaceExports(workingDirectory);
    const imports = new Map(paths.map((path) => [path, new Set<string>()]));
    const importers = new Map(paths.map((path) => [path, new Set<string>()]));
    for (const path of paths) {
        const source = await readModule(workingDirectory, path);
        if (source === null) {
            continue;
        }
        for (const specifier of moduleSpecifiers(source)) {
            const imported = resolveSpecifier(path, specifier, modules, workspaceExports);
            // A module importing itself says nothing about who needs it covered.
            if (imported === undefined || imported === path) {
                continue;
            }
            imports.get(path)?.add(imported);
            importers.get(imported)?.add(path);
        }
    }
    return { imports, importers };
}

/**
 * Selects the modules that only files owing no test import.
 *
 * A module owes a test when nothing imports it — it is an entry point — or when
 * a module that owes a test imports it. Repeating that until nothing changes
 * leaves the modules whose importers all owe no test, however deep the chain of
 * importers runs, and those are the ones a change does not have to cover.
 *
 * A module that only re-exports, like a package entry point, is never the
 * subject of the requirement itself, but it does carry the requirement: it is
 * how the product reaches what it re-exports, so the requirement flows through
 * it instead of stopping there.
 *
 * @param graph - Import graph of the checkout.
 * @param owesNoTest - Whether a path is excluded from the test requirement itself.
 * @returns Modules imported only by files that owe no test.
 */
export function modulesImportedOnlyByExemptFiles(
    graph: ImportGraph,
    owesNoTest: (path: string) => boolean,
): ReadonlySet<string> {
    const exempt = new Set(graph.imports.keys());
    let changed = true;
    while (changed) {
        changed = false;
        for (const path of exempt) {
            const importers = graph.importers.get(path) ?? NO_IMPORTERS;
            if (importers.size === 0) {
                exempt.delete(path);
                changed = true;
                continue;
            }
            for (const importer of importers) {
                if (owesNoTest(importer) || exempt.has(importer)) {
                    continue;
                }
                exempt.delete(path);
                changed = true;
                break;
            }
        }
    }
    return exempt;
}
