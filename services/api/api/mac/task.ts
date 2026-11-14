import { createMacTaskRoute } from "../../src/agent/routes.js";

export const GET = createMacTaskRoute(() => process.env);
