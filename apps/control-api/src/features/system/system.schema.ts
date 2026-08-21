import { Type } from "typebox";
import { INTERFACE_VERSION } from "../../schemas";

/** Response body of the health check. */
export const HealthSchema = Type.Object(
  { status: Type.Literal("ok") },
  { additionalProperties: false },
);

/** Response body of the version route: service identity plus interface token. */
export const VersionSchema = Type.Object(
  {
    service: Type.String(),
    version: Type.String(),
    interfaceVersion: Type.Literal(INTERFACE_VERSION),
  },
  { additionalProperties: false },
);
