/** @fileoverview The Control API's complete route table, registered explicitly. */

import type { ServerApp } from "@rostrum/server/app";
import { createServiceRegistrar } from "@rostrum/server/app";
import type { ControlApiContext } from "./control-api";
import { health } from "./services/system/health";
import { readiness } from "./services/system/readiness";
import { createWorkflowDraft } from "./services/workflows/create";
import { publishWorkflow } from "./services/workflows/publish";
import { retrieveWorkflowDraft } from "./services/workflows/retrieve-draft";
import { retrieveWorkflowPublication } from "./services/workflows/retrieve-publication";
import { retrieveWorkflowRevision } from "./services/workflows/retrieve-revision";
import { rewindWorkflow } from "./services/workflows/rewind";
import { saveWorkflowRevision } from "./services/workflows/save";
import { validateWorkflow } from "./services/workflows/validate";

/**
 * Binds every Control API route. Registration is static: no filesystem scan,
 * no dynamic import, and no folder-derived path.
 */
export function registerRoutes(app: ServerApp<ControlApiContext>): void {
    const register = createServiceRegistrar(app);

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
