/** @fileoverview The Control API's controller builder, fixed to its own context and tags. */

import { createControllerBuilder } from "@rostrum/server/controller";
import type { ControlApiContext } from "../control-api";
import type { ControlApiTag } from "./tags";

/**
 * Declares the Control API's controllers. Every controller module uses this one
 * builder, so controllers see the Control API's context fields and the generated
 * contract accepts only the Control API's tags.
 */
export const defineControlController = createControllerBuilder<ControlApiContext, ControlApiTag>();
