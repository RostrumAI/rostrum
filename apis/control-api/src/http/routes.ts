/** @fileoverview The Control API's complete route table, registered explicitly. */

import type { ServerApp } from "@rostrum/server/app";
import { createControllerRegistrar } from "@rostrum/server/app";
import type { ControlApiContext } from "../control-api";
import { health } from "../controllers/system/health";
import { readiness } from "../controllers/system/readiness";
import { createWorkflowDraft } from "../controllers/workflows/create";
import { publishWorkflow } from "../controllers/workflows/publish";
import { retrieveWorkflowDraft } from "../controllers/workflows/retrieve-draft";
import { retrieveWorkflowPublication } from "../controllers/workflows/retrieve-publication";
import { retrieveWorkflowRevision } from "../controllers/workflows/retrieve-revision";
import { rewindWorkflow } from "../controllers/workflows/rewind";
import { saveWorkflowRevision } from "../controllers/workflows/save";
import { validateWorkflow } from "../controllers/workflows/validate";

/**
 * Binds every Control API route. Registration is static: no filesystem scan,
 * no dynamic import, and no folder-derived path.
 */
export function registerRoutes(app: ServerApp<ControlApiContext>): void {
    const register = createControllerRegistrar(app);

    register(health);
    register(readiness);
    register(createWorkflowDraft);
    register(saveWorkflowRevision);
    register(rewindWorkflow);
    register(validateWorkflow);
    register(retrieveWorkflowDraft);
    register(retrieveWorkflowRevision);
    register(retrieveWorkflowPublication);
    register(publishWorkflow);
}
