/** @fileoverview Controller-boundary parser tests. */

import { describe, expect, test } from "bun:test";
import { scanImports } from "./check-controller-boundaries";

describe("controller boundary parsing", () => {
    test("reads a module that declares a generic arrow function", () => {
        // The TSX loader reads this as JSX and throws, which aborted the whole check
        // before it could report anything.
        const source =
            'const first = <T>(items: readonly T[]): T | undefined => items[0];\nimport { handle } from "./handle";';

        expect(scanImports(source).map((imported) => imported.path)).toEqual(["./handle"]);
    });

    test("reports value imports and ignores type-only ones", () => {
        // A type-only import cannot call anything, so the walk does not follow it.
        const source =
            'import { sql } from "@rostrum/database";\nimport type { Row } from "./row";';

        expect(scanImports(source).map((imported) => imported.path)).toEqual(["@rostrum/database"]);
    });
});
