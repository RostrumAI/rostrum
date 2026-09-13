/** @fileoverview Path-parameter validation middleware tests. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { Type } from "typebox";
import { parameterGuard } from "./parameter-guard";

describe("parameter guard", () => {
    test("rejects an invalid documented path parameter before the handler", async () => {
        const app = new Hono();
        let handled = false;
        app.get(
            "/items/:itemId",
            parameterGuard([
                {
                    name: "itemId",
                    in: "path",
                    description: "Item id",
                    schema: Type.String({ pattern: "^[0-9]+$" }),
                },
            ]),
            (context) => {
                handled = true;
                return context.json({ ok: true });
            },
        );

        const response = await app.request("/items/not-a-number");

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "invalid_workflow_input" });
        expect(handled).toBe(false);
    });

    test("passes valid and unguarded parameters to the handler", async () => {
        const guarded = new Hono();
        guarded.get(
            "/items/:itemId",
            parameterGuard([
                {
                    name: "itemId",
                    in: "path",
                    description: "Item id",
                    schema: Type.String({ pattern: "^[0-9]+$" }),
                },
            ]),
            (context) => context.json({ itemId: context.req.param("itemId") }),
        );
        const unguarded = new Hono();
        unguarded.get("/health", parameterGuard([]), (context) => context.json({ status: "ok" }));

        expect(await (await guarded.request("/items/42")).json()).toEqual({ itemId: "42" });
        expect(await (await unguarded.request("/health")).json()).toEqual({ status: "ok" });
    });
});
