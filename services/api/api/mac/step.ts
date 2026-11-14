import { createMacStepRoute } from "../../src/agent/routes.js";

export const maxDuration = 300;
export const POST = createMacStepRoute(() => process.env);
