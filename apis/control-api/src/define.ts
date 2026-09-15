/** @fileoverview The Control API's service builder, fixed to its own context and tags. */

import { createServiceBuilder } from "@rostrum/server/service";
import type { ControlApiContext } from "./control-api";
import type { ControlApiTag } from "./tags";

/**
 * Declares the Control API's services. Every service module uses this one
 * builder, so handlers see the Control API's context fields and the generated
 * contract accepts only the Control API's tags.
 */
export const defineControlService = createServiceBuilder<ControlApiContext, ControlApiTag>();
