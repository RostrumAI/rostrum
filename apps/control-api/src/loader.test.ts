import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadFeatures } from "./loader";

/** One feature slice exercising the full route/schema/handler contract. */
const VALID_SLICE = `
export const route = {
  method: "GET",
  path: "/ping",
  responses: { "200": { description: "Pong", schemaName: "Pong" } },
};
export const schema = { Pong: { type: "object" } };
export const handler = (c) => c.json({ pong: true });
`;

function makeRoot(): string {
    return mkdtempSync(join(tmpdir(), "control-api-features-"));
}

function writeSlice(root: string, relativePath: string, body: string): void {
    const file = join(root, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
}

const roots: string[] = [];
afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("feature loader", () => {
    test("derives the bound path and tag from the folder layout", async () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(root, "demo/ping.ts", VALID_SLICE);

        const { features, components } = await loadFeatures(root);

        expect(features).toHaveLength(1);
        const feature = features[0];
        expect(feature?.path).toBe("/demo/ping");
        expect(feature?.tag).toBe("demo");
        expect(feature?.method).toBe("GET");
        expect(typeof feature?.handler).toBe("function");
        expect(Object.keys(components)).toEqual(["Pong"]);
    });

    test("rejects a module missing the handler export and names the file", () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(root, "demo/broken.ts", `export const route = { method: "GET", path: "/x" };`);

        expect(loadFeatures(root)).rejects.toThrow("broken.ts");
    });

    test("rejects an unsupported HTTP method", () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(
            root,
            "demo/bad-method.ts",
            `export const route = { method: "FETCH", path: "/x" };
       export const handler = (c) => c.json({});`,
        );

        expect(loadFeatures(root)).rejects.toThrow("route.method must be one of");
    });

    test("rejects a response referencing an unexported schema", () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(
            root,
            "demo/dangling-ref.ts",
            `export const route = {
         method: "GET",
         path: "/x",
         responses: { "200": { description: "ok", schemaName: "Missing" } },
       };
       export const schema = {};
       export const handler = (c) => c.json({});`,
        );

        expect(loadFeatures(root)).rejects.toThrow("does not export it");
    });

    test("rejects two modules binding the same path", () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(root, "demo/first.ts", VALID_SLICE);
        writeSlice(root, "demo/second.ts", VALID_SLICE);

        expect(loadFeatures(root)).rejects.toThrow("path conflict on /demo/ping");
    });

    test("rejects two modules exporting the same component name", () => {
        const root = makeRoot();
        roots.push(root);
        writeSlice(root, "one/ping.ts", VALID_SLICE);
        writeSlice(root, "two/ping.ts", VALID_SLICE);

        expect(loadFeatures(root)).rejects.toThrow('component name conflict on "Pong"');
    });
});
